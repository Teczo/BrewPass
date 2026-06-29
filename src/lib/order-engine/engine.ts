import { ObjectId } from "mongodb";

import { addOnsTotalSen } from "@/lib/addons";
import { vendorDrinkPriceSen } from "@/lib/menu";
import {
  corporateAccountsCollection,
  locationsCollection,
  ordersCollection,
  preferencesCollection,
  preferenceSignalsCollection,
  subscriptionsCollection,
  usersCollection,
  vendorsCollection,
} from "@/lib/collections";
import { newDocumentMeta } from "@/lib/models";
import { personalPreferenceFilter } from "@/lib/preferences";
import type { Order, Subscription } from "@/lib/models";
import { escapeHtml, sendEmail, sendPushToUser } from "@/lib/notifications";
import { loadSkippedUserIdsForDate } from "@/lib/monthly-list/service";
import { buildOrder, evaluateCutoff, evaluateGeneration } from "@/lib/order-engine/logic";
import { deliveryHourOf, hasAreaCoverage } from "@/lib/order-engine/routing";
import { recordWaitlistEntry } from "@/lib/launch-waitlist";
import {
  loadRoutingCandidates,
  selectVendor,
  type RoutingCandidate,
} from "@/lib/order-engine/routing-data";
import { chargeOrderCoffee } from "@/lib/payments/charge";
import { resolveChargeCard } from "@/lib/payments/charge-card";
import {
  applyTimeWindowDiscountToOrder,
  loadTimeWindowDiscountsByVendor,
} from "@/lib/promotions/discounts";
import { resolveCommissionBps } from "@/lib/payments/commission";
import { splitOrderAmount } from "@/lib/payments/money";
import { recordAcceptance } from "@/lib/quality-service";
import { getStripe } from "@/lib/stripe";
import { pickSuggestion } from "@/lib/suggestions";
import { formatLocalTime12h, isoWeekdayOf, localDateOf, localTimeOf } from "@/lib/time";
import { emitOrderEvent } from "@/lib/webhooks/emit";
import { makeWeatherCache } from "@/lib/weather";

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export interface GenerationSummary {
  date: string;
  generated: number;
  duplicates: number;
  skipped: Array<{ subscriptionId: string; reason: string }>;
}

/**
 * Nightly generation (idempotent): one `scheduled` order per eligible
 * subscription for `localDate`. The unique (userId, date) index is the
 * idempotency key — re-runs and concurrent runs cannot double-generate
 * (critical rule #1).
 */
export async function generateOrdersForDate(
  localDate: string,
  now: Date = new Date(),
): Promise<GenerationSummary> {
  const [subscriptions, preferences, locations, orders] = await Promise.all([
    subscriptionsCollection(),
    preferencesCollection(),
    locationsCollection(),
    ordersCollection(),
  ]);

  const [candidateSubs, routingCandidates, skippedUserIds, timeWindowDiscounts] = await Promise.all(
    [
      subscriptions.find({ status: { $in: ["active", "trialing"] } }).toArray(),
      loadRoutingCandidates(localDate),
      // Phase D.5: days a user explicitly skipped in a confirmed monthly list
      // must never get an auto-generated order. Days the list already filled
      // are protected by the unique (userId, date) order index instead.
      loadSkippedUserIdsForDate(localDate),
      // Phase K.2: vendor time-window discounts applied to the snapshotted price.
      loadTimeWindowDiscountsByVendor(localDate),
    ],
  );
  // Mutated in place as orders are assigned, so per-vendor capacity holds
  // across the whole run.
  const candidateByVendor = new Map<string, RoutingCandidate>(
    routingCandidates.map((candidate) => [candidate.vendor._id.toHexString(), candidate]),
  );
  const weekday = isoWeekdayOf(localDate);

  const summary: GenerationSummary = { date: localDate, generated: 0, duplicates: 0, skipped: [] };

  for (const subscription of candidateSubs) {
    const subId = subscription._id.toHexString();

    if (skippedUserIds.has(subscription.userId.toHexString())) {
      summary.skipped.push({ subscriptionId: subId, reason: "skipped_in_monthly_list" });
      continue;
    }

    const preference = await preferences.findOne(personalPreferenceFilter(subscription.userId));

    const decision = evaluateGeneration(subscription, preference, localDate);
    if (!decision.ok) {
      summary.skipped.push({ subscriptionId: subId, reason: decision.reason });
      continue;
    }

    const location = await locations.findOne({
      _id: preference!.defaultLocationId,
      userId: subscription.userId,
    });
    if (!location) {
      summary.skipped.push({ subscriptionId: subId, reason: "no_default_location" });
      continue;
    }

    // Routing engine: confirmed preferred vendor when eligible, else
    // auto-route to the best available (critical rule #2 — server decides).
    const result = selectVendor(
      {
        preferredVendorId: preference!.preferredVendorId ?? null,
        point: location.geo,
        date: localDate,
        weekday,
        time: preference!.schedule.time,
        drink: { drink: preference!.defaultDrink.drink, milk: preference!.defaultDrink.milk },
        nowLocalDate: localDateOf(now),
        nowLocalTime: localTimeOf(now),
      },
      routingCandidates,
    );
    if (!result.ok) {
      // Phase O.1: distinguish a true coverage gap (no vendor's service area
      // covers this address at all) from a transient all-busy day. A gap means
      // the user should be waitlisted and emailed when coverage arrives
      // (fallbacks.md §1.1/§1.2); a transient miss is left to retry (O.2). Either
      // way generation skips silently here — no failure is pushed to the user.
      if (!hasAreaCoverage(routingCandidates, location.geo)) {
        try {
          await recordWaitlistEntry({
            userId: subscription.userId,
            address: location.address,
            geo: location.geo,
            now,
          });
        } catch (error) {
          // Best-effort: a waitlist write must never break generation.
          console.error(
            `Waitlist record failed for user ${subscription.userId.toHexString()}:`,
            error,
          );
        }
        summary.skipped.push({ subscriptionId: subId, reason: "waitlisted_no_coverage" });
        continue;
      }
      summary.skipped.push({ subscriptionId: subId, reason: result.reason });
      continue;
    }

    const candidate = candidateByVendor.get(result.vendorId.toHexString())!;
    const order = buildOrder({
      subscription,
      preference: preference!,
      location,
      vendor: candidate.vendor,
      assignmentMethod: result.method,
      // Snapshot the vendor's price for the cutoff charge (Phase E).
      priceSen: vendorDrinkPriceSen(candidate.menuItems, preference!.defaultDrink.drink),
      localDate,
      now,
    });
    // Phase K.2: apply any vendor time-window discount to the snapshotted price.
    applyTimeWindowDiscountToOrder(
      order,
      timeWindowDiscounts.get(candidate.vendor._id.toHexString()) ?? [],
      weekday,
      preference!.schedule.time,
    );
    try {
      await orders.insertOne(order);
      summary.generated += 1;
      // Occupy a daily + per-hour capacity slot for the rest of this run.
      candidate.assignedCount += 1;
      const hour = deliveryHourOf(preference!.schedule.time);
      candidate.assignedByHour[hour] = (candidate.assignedByHour[hour] ?? 0) + 1;
      // Phase I.5: best-effort outbound event (never blocks generation).
      await emitOrderEvent("order.scheduled", order, now, {
        vendorExternalIdHint: candidate.vendor.externalId,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        summary.duplicates += 1; // already generated by an earlier run
      } else {
        throw error;
      }
    }
  }
  return summary;
}

export interface NotificationSummary {
  date: string;
  notified: number;
}

/**
 * Send the night-before notification for every un-notified scheduled order
 * on `localDate`. Each order is claimed by setting notifiedAt first, so
 * re-runs can't double-send (at-most-once delivery). A Phase 8 suggestion
 * is computed from the user's PreferenceSignal history (+ tomorrow's
 * weather) and stored on the order — advisory only, applied exclusively
 * through the user-confirmed modify flow.
 */
export async function notifyOrdersForDate(
  localDate: string,
  now: Date = new Date(),
): Promise<NotificationSummary> {
  const [orders, users, signals] = await Promise.all([
    ordersCollection(),
    usersCollection(),
    preferenceSignalsCollection(),
  ]);
  const summary: NotificationSummary = { date: localDate, notified: 0 };
  const weatherFor = makeWeatherCache();

  const candidates = await orders
    .find({ date: localDate, status: "scheduled", notifiedAt: { $exists: false } })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();

  for (const candidate of candidates) {
    const current = await orders.findOne({ _id: candidate._id });
    if (!current || current.status !== "scheduled" || current.notifiedAt) continue;

    // Compute the suggestion before claiming (read-only, can be slow).
    let suggestion = null;
    try {
      const history = await signals
        .find({ userId: current.userId })
        .sort({ date: -1 })
        .limit(90)
        .toArray();
      suggestion = pickSuggestion({
        signals: history.map((s) => ({
          weekday: s.context.weekday,
          weather: s.context.weather,
          locationLabel: s.context.locationLabel,
          drink: s.chosenDrink.drink,
        })),
        targetWeekday: isoWeekdayOf(localDate),
        tomorrowWeather: await weatherFor(current.location.geo, localDate),
        currentDrink: current.drink.drink,
        currentLocationLabel: current.location.label,
      });
    } catch (error) {
      console.error(`Suggestion for order ${current._id.toHexString()} failed:`, error);
    }

    // Claim (notifiedAt) and persist the suggestion atomically.
    const order = await orders.findOneAndUpdate(
      { _id: current._id, status: "scheduled", notifiedAt: { $exists: false } },
      {
        $set: {
          notifiedAt: now,
          updatedAt: now,
          ...(suggestion
            ? {
                suggestion: {
                  ...(suggestion.kind === "drink" ? { drink: suggestion.drink } : {}),
                  ...(suggestion.kind === "location"
                    ? { locationLabel: suggestion.locationLabel }
                    : {}),
                  reason: suggestion.reason,
                  message: suggestion.message,
                },
              }
            : {}),
        },
      },
      { returnDocument: "after" },
    );
    if (!order) continue; // another worker claimed it

    const user = await users.findOne({ _id: order.userId });
    if (!user) continue;

    const deliveryTime = formatLocalTime12h(localTimeOf(order.deliverAt));
    const title = "Tomorrow's coffee is ready to go ☕";
    const body =
      `A ${order.drink.drink} to ${order.location.label} at ${deliveryTime}. ` +
      `Change or skip before 6:00 AM.` +
      (suggestion ? ` 💡 ${suggestion.message}` : "");

    try {
      const pushResult = await sendPushToUser(user, { title, body });
      if (pushResult.invalidTokens.length > 0) {
        await users.updateOne(
          { _id: user._id },
          { $pull: { fcmTokens: { $in: pushResult.invalidTokens } } },
        );
      }
      await sendEmail({
        to: user.email,
        subject: title,
        // body contains user-controlled strings (drink/location names) —
        // escape before interpolating into HTML.
        html: `<p>${escapeHtml(body)}</p><p><a href="${process.env.APP_BASE_URL ?? ""}/dashboard">Review your order</a></p>`,
      });
    } catch (error) {
      // Notification failures must never break the engine.
      console.error(`Notification for order ${order._id.toHexString()} failed:`, error);
    }
    summary.notified += 1;
  }
  return summary;
}

export interface CutoffSummary {
  processed: number;
  confirmed: number;
  failed: Array<{ orderId: string; reason: string }>;
}

/**
 * Lock every scheduled order whose cutoff has passed: decrement the plan
 * quota exactly once and mark the order `confirmed` (prepaid model — no
 * payment capture). Each order is claimed atomically, so concurrent or
 * re-run jobs can never double-decrement (critical rule #1).
 */
export async function processCutoffs(now: Date = new Date()): Promise<CutoffSummary> {
  const [orders, subscriptions, signals] = await Promise.all([
    ordersCollection(),
    subscriptionsCollection(),
    preferenceSignalsCollection(),
  ]);
  const summary: CutoffSummary = { processed: 0, confirmed: 0, failed: [] };
  const weatherFor = makeWeatherCache();

  for (;;) {
    // Claim each due order atomically (scheduled → confirmed). Exactly one
    // worker wins, so the quota decrement below runs at most once per
    // order. If we crash before the decrement the user gets a coffee
    // without quota deduction — the safe direction; double-decrementing
    // is the failure mode we must never allow.
    const order = await orders.findOneAndUpdate(
      { status: "scheduled", cutoffAt: { $lte: now } },
      { $set: { status: "confirmed", confirmedAt: now, updatedAt: now } },
      { returnDocument: "before" },
    );
    if (!order) break;
    summary.processed += 1;

    let confirmed = false;
    let failReason: string | null = null;
    let subscription: Subscription | null = null;

    if (order.source === "corporate") {
      // Phase J.7 — office coffee: charge the COMPANY card (rule #17), never a
      // member's personal card. No subscription/quota — billed per delivered
      // coffee. Handoff is gated on the charge (retry-once-then-skip; rule #3);
      // a failure here can never touch anyone's personal coffee.
      const outcome = await chargeConfirmedOrder(order, now);
      confirmed = outcome.ok;
      if (!outcome.ok) {
        await orders.updateOne(
          { _id: order._id },
          { $set: { chargeStatus: "failed" as const, updatedAt: now } },
        );
        failReason = `charge_failed: ${outcome.reason}`;
      }
    } else {
      subscription = order.subscriptionId
        ? await subscriptions.findOne({ _id: order.subscriptionId })
        : null;
      const decision = evaluateCutoff(subscription);
      if (decision.action === "confirm") {
        if (subscription?.billingMode === "card_on_file") {
          // Phase E: charge the coffee per-day into the platform balance (the
          // vendor is paid only after delivery). No quota gate — pay per coffee.
          // On failure (retry-once-then-skip; rule #3) the order fails uncharged.
          const outcome = await chargeConfirmedOrder(order, now);
          confirmed = outcome.ok;
          if (!outcome.ok) {
            await orders.updateOne(
              { _id: order._id },
              { $set: { chargeStatus: "failed" as const, updatedAt: now } },
            );
            failReason = `charge_failed: ${outcome.reason}`;
          }
        } else {
          // Prepaid (legacy): guarded decrement, only while the plan is live
          // and quota remains. No per-coffee charge.
          const result = await subscriptions.updateOne(
            {
              _id: order.subscriptionId,
              status: { $in: ["active", "trialing"] },
              $expr: { $lt: ["$quota.used", "$quota.total"] },
            },
            { $inc: { "quota.used": 1 }, $set: { updatedAt: now } },
          );
          confirmed = result.modifiedCount === 1;
          if (!confirmed) failReason = "quota_exhausted";
        }
      } else {
        failReason = decision.reason;
      }
    }

    if (confirmed) {
      summary.confirmed += 1;

      // Phase I.5: best-effort outbound event for the locked/charged order.
      await emitOrderEvent("order.confirmed", { ...order, status: "confirmed" }, now);

      // Phase G: an order that locks without a decline is an implicit accept
      // for the assigned vendor — feeds the acceptance rate. Best-effort.
      try {
        await recordAcceptance(order.vendorId, now);
      } catch (error) {
        console.error(`Acceptance metric for order ${order._id.toHexString()} failed:`, error);
      }

      // Phase 10: charge add-ons off-session to the card saved at
      // subscription checkout. Idempotent per order via Stripe
      // idempotency key; the claim above means one attempt per run and
      // the key dedupes across re-runs. A failed charge drops the
      // add-ons but NEVER touches the confirmed coffee.
      if (order.addOns && order.addOns.length > 0 && subscription) {
        await chargeAddOns(order._id, order.addOns, subscription.stripeSubscriptionId, now);
      }

      // Phase 8: append-only preference signal per confirmed order
      // (unique on orderId — duplicate inserts are ignored). Weather is
      // recorded so rainy-day patterns can be learned; best-effort. Office
      // coffee never feeds personal suggestions (rule #16) — personal only.
      if (order.source === "personal") {
        try {
          const weather = await weatherFor(order.location.geo, order.date);
          await signals.insertOne({
            _id: new ObjectId(),
            ...newDocumentMeta(),
            userId: order.userId,
            orderId: order._id,
            date: order.date,
            context: {
              weekday: isoWeekdayOf(order.date),
              locationLabel: order.location.label,
              ...(weather !== "unknown" ? { weather } : {}),
            },
            chosenDrink: { ...order.drink },
            userModified: Boolean(order.modifiedByUserAt),
            createdAt: now,
            updatedAt: now,
          });
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
        }
      }
    } else {
      const reason = failReason ?? "quota_exhausted";
      await orders.updateOne(
        { _id: order._id },
        {
          $set: { status: "failed", failureReason: reason, updatedAt: now },
          $unset: { confirmedAt: "" },
        },
      );
      summary.failed.push({ orderId: order._id.toHexString(), reason });
      // Phase I.5: best-effort outbound event for the failed order.
      await emitOrderEvent(
        "order.failed",
        { ...order, status: "failed", failureReason: reason },
        now,
      );
      // Phase J.7: a failed company-card charge skips just this office coffee
      // and notifies the team admin — personal coffees (other orders) are
      // untouched. Best-effort; never breaks the cutoff loop.
      if (order.source === "corporate") {
        await notifyOwnerOfOfficeChargeFailure(order, reason);
      }
    }
  }
  return summary;
}

export interface CoffeeChargeOutcome {
  ok: boolean;
  reason?: string;
}

/**
 * Charge a confirmed order for its coffee and, on success, snapshot the
 * commission split. Personal orders (Phase E) hit the member's saved card;
 * office orders (Phase J.7) hit the company card — `resolveChargeCard` enforces
 * the separation (rule #17), so neither can ever be charged to the other's
 * card. The charge lands in the platform balance; the vendor's net is
 * transferred only after delivery.
 *
 * A missing/zero price (vendor hasn't published one) is not a card failure —
 * we confirm without charging and leave chargeStatus unset, so no payout is
 * ever released for an uncharged coffee. Idempotent per order (coffee_<orderId>).
 */
async function chargeConfirmedOrder(order: Order, now: Date): Promise<CoffeeChargeOutcome> {
  const amountSen = order.priceSen ?? 0;
  if (amountSen <= 0) {
    console.warn(`Order ${order._id.toHexString()} has no price; confirming without charge.`);
    return { ok: true };
  }

  const [users, accounts, vendors, orders] = await Promise.all([
    usersCollection(),
    corporateAccountsCollection(),
    vendorsCollection(),
    ordersCollection(),
  ]);
  const vendor = await vendors.findOne({ _id: order.vendorId });
  if (!vendor) return { ok: false, reason: "vendor_missing" };

  // Resolve the correct card by source — personal → member card, corporate →
  // company card (rule #17). Only the relevant entity is loaded.
  const [user, account] = await Promise.all([
    order.source === "corporate" ? Promise.resolve(null) : users.findOne({ _id: order.userId }),
    order.source === "corporate" && order.corporateAccountId
      ? accounts.findOne({ _id: order.corporateAccountId })
      : Promise.resolve(null),
  ]);
  const cardResult = resolveChargeCard(order, { user, account });
  if (!cardResult.ok) return { ok: false, reason: cardResult.reason };

  const result = await chargeOrderCoffee({
    orderId: order._id.toHexString(),
    customerId: cardResult.card.customerId,
    paymentMethodId: cardResult.card.paymentMethodId,
    amountSen,
    drinkName: order.drink.drink,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  // Snapshot the split at charge time (critical rule #6) — payout reads these,
  // never a live commission rate.
  const commissionBps = await resolveCommissionBps(vendor);
  const split = splitOrderAmount(amountSen, commissionBps);
  await orders.updateOne(
    { _id: order._id },
    {
      $set: {
        chargeStatus: "charged" as const,
        stripeChargeId: result.paymentIntentId,
        chargedAt: now,
        commissionAmountSen: split.commissionSen,
        vendorNetAmountSen: split.vendorNetSen,
        updatedAt: now,
      },
    },
  );
  return { ok: true };
}

/**
 * Notify the team admin (billing owner) that the company card couldn't be
 * charged for a member's office coffee, so they can fix it. Best-effort —
 * never throws. Personal coffees are on personal cards and unaffected.
 */
async function notifyOwnerOfOfficeChargeFailure(order: Order, reason: string): Promise<void> {
  try {
    if (!order.corporateAccountId) return;
    const [accounts, users] = await Promise.all([corporateAccountsCollection(), usersCollection()]);
    const account = await accounts.findOne({ _id: order.corporateAccountId });
    if (!account) return;
    const [owner, member] = await Promise.all([
      users.findOne({ _id: account.billingOwnerUserId }),
      users.findOne({ _id: order.userId }),
    ]);
    if (!owner) return;

    const who = member?.name ?? "a team member";
    const title = "Office coffee skipped — company card declined";
    const body =
      `We couldn't charge the company card for ${who}'s office coffee on ${order.date} ` +
      `(${reason}). That coffee was skipped. Update the company card to avoid further misses.`;

    const pushResult = await sendPushToUser(owner, { title, body });
    if (pushResult.invalidTokens.length > 0) {
      await users.updateOne(
        { _id: owner._id },
        { $pull: { fcmTokens: { $in: pushResult.invalidTokens } } },
      );
    }
    await sendEmail({
      to: owner.email,
      subject: title,
      html: `<p>${escapeHtml(body)}</p><p><a href="${process.env.APP_BASE_URL ?? ""}/dashboard/corporate">Manage your company</a></p>`,
    });
  } catch (error) {
    console.error(`Owner notify for office order ${order._id.toHexString()} failed:`, error);
  }
}

/**
 * Off-session PaymentIntent for an order's add-ons. The payment method is
 * the one saved on the customer's subscription at checkout. Failure marks
 * addOnsPaymentStatus=failed and removes the add-ons; the coffee itself
 * is untouched (it's covered by the prepaid quota).
 */
async function chargeAddOns(
  orderId: ObjectId,
  addOns: NonNullable<Order["addOns"]>,
  stripeSubscriptionId: string,
  now: Date,
): Promise<void> {
  const orders = await ordersCollection();
  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const paymentMethod =
      typeof sub.default_payment_method === "string"
        ? sub.default_payment_method
        : sub.default_payment_method?.id;

    const intent = await stripe.paymentIntents.create(
      {
        amount: addOnsTotalSen(addOns),
        currency: "myr",
        customer: customerId,
        ...(paymentMethod ? { payment_method: paymentMethod } : {}),
        off_session: true,
        confirm: true,
        description: `BrewPass add-ons: ${addOns.map((a) => a.name).join(", ")}`,
        metadata: { orderId: orderId.toHexString() },
      },
      { idempotencyKey: `addons_${orderId.toHexString()}` },
    );

    await orders.updateOne(
      { _id: orderId },
      {
        $set: {
          stripePaymentIntentId: intent.id,
          addOnsPaymentStatus: "paid" as const,
          updatedAt: now,
        },
      },
    );
  } catch (error) {
    console.error(`Add-on charge for order ${orderId.toHexString()} failed:`, error);
    await orders.updateOne(
      { _id: orderId },
      {
        $set: { addOnsPaymentStatus: "failed" as const, updatedAt: now },
        $unset: { addOns: "" },
      },
    );
  }
}
