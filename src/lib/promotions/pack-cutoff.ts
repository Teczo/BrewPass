import { ObjectId } from "mongodb";

import {
  corporateAccountsCollection,
  corporateMembershipsCollection,
  locationsCollection,
  ordersCollection,
  packPurchasesCollection,
  usersCollection,
  vendorsCollection,
} from "@/lib/collections";
import { getOrSeedOfficePreference } from "@/lib/corporate/office-preference";
import { newDocumentMeta } from "@/lib/models";
import type { CorporateAccount, Order, PackPurchase } from "@/lib/models";
import { escapeHtml, sendEmail, sendPushToUser } from "@/lib/notifications";
import { chargeOrderCoffee } from "@/lib/payments/charge";
import { resolveChargeCard } from "@/lib/payments/charge-card";
import { resolveCommissionBps } from "@/lib/payments/commission";
import {
  allocatePackAmounts,
  resolvePackCommissionBps,
  vendorAvailableForPinnedPack,
} from "@/lib/promotions/pack-math";
import { cutoffInstantFor, utcInstantOfLocal } from "@/lib/time";
import { emitOrderEvent } from "@/lib/webhooks/emit";

/**
 * Phase K.1 — Vendor Pack charging at cutoff (charge-then-deliver, rule #3).
 *
 * Runs BEFORE the per-order cutoff sweep. For each due pending PackPurchase it
 * charges the company card the pack price ONCE (paid-for-and-skipped slots
 * included) and materializes one vendor-pinned, delivery-gated Order per
 * assigned coffee with the pack's net allocated across them (rule #4). The pack
 * does NOT re-route (rule #20): if the vendor is offline at cutoff the pack is
 * skipped (nothing charged) and the admin notified. A company-card decline
 * fails the pack and alerts the owner — personal coffee is never affected.
 *
 * Top-up coffees for overflow members are normal routed office orders generated
 * the night before; they are charged by the regular per-order sweep and only
 * linked here for grouping.
 */
export interface PackCutoffSummary {
  processed: number;
  charged: number;
  skipped: Array<{ packPurchaseId: string; reason: string }>;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export async function processPackCutoffs(now: Date = new Date()): Promise<PackCutoffSummary> {
  const summary: PackCutoffSummary = { processed: 0, charged: 0, skipped: [] };
  const packs = await packPurchasesCollection();
  const due = await packs.find({ status: "pending" }).toArray();

  for (const pack of due) {
    // Only act once the pack's delivery-date cutoff has passed.
    if (cutoffInstantFor(pack.date).getTime() > now.getTime()) continue;
    summary.processed += 1;
    const outcome = await chargeAndMaterializePack(pack, now);
    if (outcome.ok) summary.charged += 1;
    else summary.skipped.push({ packPurchaseId: pack._id.toHexString(), reason: outcome.reason });
  }
  return summary;
}

type PackOutcome = { ok: true } | { ok: false; reason: string };

async function chargeAndMaterializePack(pack: PackPurchase, now: Date): Promise<PackOutcome> {
  const [packs, accounts, vendors, orders] = await Promise.all([
    packPurchasesCollection(),
    corporateAccountsCollection(),
    vendorsCollection(),
    ordersCollection(),
  ]);

  const account = await accounts.findOne({ _id: pack.corporateAccountId });
  const vendor = await vendors.findOne({ _id: pack.packSnapshot.vendorId });
  if (!account || !vendor) {
    await packs.updateOne(
      { _id: pack._id },
      { $set: { status: "failed", failureReason: "account_or_vendor_missing", updatedAt: now } },
    );
    return { ok: false, reason: "account_or_vendor_missing" };
  }

  // Vendor-pinned: no reroute. Offline vendor → skip/refund the day's pack and
  // notify the admin (rule #20). Nothing is charged, so there's nothing to
  // refund here; a vendor going offline AFTER charge is a delivery failure that
  // the per-order auto-refund handles.
  if (!vendorAvailableForPinnedPack(vendor, pack.date)) {
    await packs.updateOne(
      { _id: pack._id },
      { $set: { status: "skipped", failureReason: "pack_vendor_offline", updatedAt: now } },
    );
    await notifyOwnerOfPackIssue(
      account,
      `Pack skipped — ${vendor.businessName} is closed`,
      `Your ${pack.packSnapshot.packSize}-pack from ${vendor.businessName} on ${pack.date} couldn't go ahead because the vendor is offline, so it was skipped (no charge). Packs don't switch vendors, so try another vendor's pack or per-member coffee.`,
    );
    return { ok: false, reason: "pack_vendor_offline" };
  }

  // Charge-then-deliver: resolve the company card (never a member's, rule #17).
  const card = resolveChargeCard(
    { source: "corporate", corporateAccountId: pack.corporateAccountId },
    { user: null, account },
  );
  if (!card.ok) {
    await packs.updateOne(
      { _id: pack._id },
      { $set: { status: "failed", failureReason: card.reason, updatedAt: now } },
    );
    await notifyOwnerOfPackIssue(
      account,
      "Pack not charged — company card issue",
      `We couldn't charge the company card for your ${pack.packSnapshot.packSize}-pack on ${pack.date} (${card.reason}). Add or update the company card and buy the pack again.`,
    );
    return { ok: false, reason: card.reason };
  }

  if (pack.assignments.length === 0) {
    // Nothing to make; don't charge an empty pack.
    await packs.updateOne(
      { _id: pack._id },
      { $set: { status: "skipped", failureReason: "no_assignments", updatedAt: now } },
    );
    return { ok: false, reason: "no_assignments" };
  }

  // One charge for the whole pack price into the platform balance.
  const charge = await chargeOrderCoffee({
    orderId: pack._id.toHexString(),
    customerId: card.card.customerId,
    paymentMethodId: card.card.paymentMethodId,
    amountSen: pack.packSnapshot.packPriceSen,
    drinkName: `${vendor.businessName} ${pack.packSnapshot.packSize}-pack`,
  });
  if (!charge.ok) {
    await packs.updateOne(
      { _id: pack._id },
      {
        $set: {
          status: "failed",
          chargeStatus: "failed",
          failureReason: `charge_failed: ${charge.reason}`,
          updatedAt: now,
        },
      },
    );
    await notifyOwnerOfPackIssue(
      account,
      "Pack charge failed — company card declined",
      `The company card was declined for your ${pack.packSnapshot.packSize}-pack from ${vendor.businessName} on ${pack.date} (${charge.reason}). The pack was skipped. Update the card to avoid further misses. Personal coffees are unaffected.`,
    );
    return { ok: false, reason: `charge_failed: ${charge.reason}` };
  }

  // Allocate the pack's net across the assigned coffees for delivery-gated
  // payout (commission on the pack gross; rule #11 — promo override or fallback).
  const vendorBps = await resolveCommissionBps(vendor);
  const commissionBps = resolvePackCommissionBps(
    pack.packSnapshot.commissionRateOverrideBps,
    vendorBps,
  );
  const slots = allocatePackAmounts(
    pack.packSnapshot.packPriceSen,
    commissionBps,
    pack.assignments.length,
  );

  const memberships = await corporateMembershipsCollection();
  const locations = await locationsCollection();

  for (let i = 0; i < pack.assignments.length; i += 1) {
    const assignment = pack.assignments[i];
    const slot = slots[i];
    const membership = await memberships.findOne({ _id: assignment.corporateMembershipId });
    if (!membership || membership.status !== "active") continue; // paid-for-and-skipped

    const officePref = await getOrSeedOfficePreference(account, membership, now);
    if (!officePref) continue; // no office setup → slot paid-for-and-skipped
    const location = await locations.findOne({ _id: officePref.defaultLocationId });
    if (!location) continue;

    // Safety for a pack bought after the night-before generation: drop the
    // member's normal (still-scheduled) office order before inserting the pack
    // order, so the unique (userId, date, source) index doesn't collide.
    await orders.deleteOne({
      userId: membership.userId,
      date: pack.date,
      source: "corporate",
      status: "scheduled",
    });

    const order: Order = {
      _id: new ObjectId(),
      ...newDocumentMeta(),
      userId: membership.userId,
      source: "corporate",
      corporateMembershipId: membership._id,
      corporateAccountId: account._id,
      date: pack.date,
      drink: { ...assignment.drinkSpec },
      location: {
        locationId: location._id,
        label: location.label,
        address: location.address,
        geo: { ...location.geo },
        ...(location.notes ? { notes: location.notes } : {}),
      },
      vendorId: vendor._id,
      packPurchaseId: pack._id,
      packCovered: true,
      vendorPinned: true,
      status: "confirmed",
      priceSen: slot.grossSen,
      chargeStatus: "charged",
      stripeChargeId: charge.paymentIntentId,
      chargedAt: now,
      commissionAmountSen: slot.commissionSen,
      vendorNetAmountSen: slot.vendorNetSen,
      cutoffAt: cutoffInstantFor(pack.date),
      deliverAt: utcInstantOfLocal(pack.date, officePref.schedule.time),
      autoGenerated: true,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await orders.insertOne(order);
      await emitOrderEvent("order.confirmed", order, now, {
        vendorExternalIdHint: vendor.externalId,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  // Link the overflow top-up orders (normal routed office orders) for grouping.
  const topUpOrders =
    pack.topUpMembershipIds.length > 0
      ? await orders
          .find({
            corporateAccountId: account._id,
            corporateMembershipId: { $in: pack.topUpMembershipIds },
            date: pack.date,
            source: "corporate",
          })
          .project<{ _id: ObjectId }>({ _id: 1 })
          .toArray()
      : [];

  await packs.updateOne(
    { _id: pack._id },
    {
      $set: {
        status: "charged",
        chargeStatus: "charged",
        stripeChargeId: charge.paymentIntentId,
        chargedAt: now,
        topUpOrderIds: topUpOrders.map((o) => o._id),
        updatedAt: now,
      },
    },
  );
  return { ok: true };
}

/** Best-effort owner notification for a pack issue (never throws). */
async function notifyOwnerOfPackIssue(
  account: CorporateAccount,
  subject: string,
  body: string,
): Promise<void> {
  try {
    const users = await usersCollection();
    const owner = await users.findOne({ _id: account.billingOwnerUserId });
    if (!owner) return;
    const pushResult = await sendPushToUser(owner, { title: subject, body });
    if (pushResult.invalidTokens.length > 0) {
      await users.updateOne(
        { _id: owner._id },
        { $pull: { fcmTokens: { $in: pushResult.invalidTokens } } },
      );
    }
    await sendEmail({
      to: owner.email,
      subject,
      html: `<p>${escapeHtml(body)}</p><p><a href="${process.env.APP_BASE_URL ?? ""}/dashboard/corporate">Manage your company</a></p>`,
    });
  } catch (error) {
    console.error(`Pack owner notify for ${account._id.toHexString()} failed:`, error);
  }
}
