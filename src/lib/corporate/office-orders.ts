import {
  corporateAccountsCollection,
  corporateMembershipsCollection,
  locationsCollection,
  ordersCollection,
} from "@/lib/collections";
import { resolveSelectionMode } from "@/lib/corporate/autonomy";
import { getOrSeedOfficePreference } from "@/lib/corporate/office-preference";
import { vendorDrinkPriceSen } from "@/lib/menu";
import type { CorporateAccount, DrinkSpec } from "@/lib/models";
import { buildOfficeOrder } from "@/lib/order-engine/logic";
import { deliveryHourOf } from "@/lib/order-engine/routing";
import {
  loadRoutingCandidates,
  selectVendor,
  type RoutingCandidate,
} from "@/lib/order-engine/routing-data";
import {
  applyTimeWindowDiscountToOrder,
  loadTimeWindowDiscountsByVendor,
} from "@/lib/promotions/discounts";
import {
  loadPackCoverageByCompany,
  memberGenerationDecision,
} from "@/lib/promotions/pack-coverage";
import { isoWeekdayOf, localDateOf, localTimeOf } from "@/lib/time";
import { emitOrderEvent } from "@/lib/webhooks/emit";

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export interface OfficeGenerationSummary {
  date: string;
  generated: number;
  duplicates: number;
  skipped: Array<{ membershipId: string; reason: string }>;
}

/**
 * Nightly OFFICE-order generation (Phase J.7), idempotent: one `scheduled`
 * corporate order per eligible active membership for `localDate`. The unique
 * (userId, date, source) index is the idempotency key, so this runs safely
 * alongside personal generation — a member can get both a personal and an
 * office order on the same day (rule #17).
 *
 * Eligibility per membership: the company must have a card on file (office
 * coffee is charge-then-deliver) and office defaults configured; the member's
 * office schedule must include today. The drink is the owner's bundle drink in
 * `bundle` mode, otherwise the member's (snapshotted, rule #6). Routing,
 * pricing, and capacity reuse the personal engine's primitives.
 */
export async function generateOfficeOrdersForDate(
  localDate: string,
  now: Date = new Date(),
): Promise<OfficeGenerationSummary> {
  const [
    memberships,
    accounts,
    locations,
    orders,
    routingCandidates,
    packCoverage,
    timeWindowDiscounts,
  ] = await Promise.all([
    corporateMembershipsCollection(),
    corporateAccountsCollection(),
    locationsCollection(),
    ordersCollection(),
    loadRoutingCandidates(localDate),
    // Phase K.1: companies with a Vendor Pack that day drive coverage via the
    // pack flow, not normal per-member generation.
    loadPackCoverageByCompany(localDate),
    // Phase K.2: vendor time-window discounts applied to office coffees too.
    loadTimeWindowDiscountsByVendor(localDate),
  ]);

  const candidateByVendor = new Map<string, RoutingCandidate>(
    routingCandidates.map((candidate) => [candidate.vendor._id.toHexString(), candidate]),
  );
  const weekday = isoWeekdayOf(localDate);
  const accountCache = new Map<string, CorporateAccount | null>();

  const summary: OfficeGenerationSummary = {
    date: localDate,
    generated: 0,
    duplicates: 0,
    skipped: [],
  };

  const activeMembers = await memberships.find({ status: "active" }).toArray();

  for (const membership of activeMembers) {
    const memId = membership._id.toHexString();
    const accKey = membership.corporateAccountId.toHexString();

    // Phase K.1: skip members covered by their company's pack — assigned
    // members get a vendor-pinned pack order at cutoff; uncovered members of a
    // packed company get no office coffee. Top-up members fall through and
    // generate a normal routed office order.
    const decision = memberGenerationDecision(packCoverage.get(accKey), memId);
    if (decision !== "generate") {
      summary.skipped.push({ membershipId: memId, reason: decision });
      continue;
    }

    let account = accountCache.get(accKey);
    if (account === undefined) {
      account = await accounts.findOne({ _id: membership.corporateAccountId });
      accountCache.set(accKey, account);
    }
    if (!account) {
      summary.skipped.push({ membershipId: memId, reason: "account_missing" });
      continue;
    }
    // Charge-then-deliver: never generate an office order we can't charge.
    if (!account.companyStripePaymentMethodId) {
      summary.skipped.push({ membershipId: memId, reason: "no_company_card" });
      continue;
    }

    // Office preference holds the schedule/location (and drink in individual
    // mode), seeded from the owner's office defaults.
    const officePref = await getOrSeedOfficePreference(account, membership, now);
    if (!officePref) {
      summary.skipped.push({ membershipId: memId, reason: "no_office_setup" });
      continue;
    }
    if (!officePref.schedule.days.includes(weekday)) {
      summary.skipped.push({ membershipId: memId, reason: "not_scheduled_today" });
      continue;
    }

    // Bundle mode → the owner's one coffee for everyone; else the member's.
    const drink: DrinkSpec =
      resolveSelectionMode(account) === "bundle" && account.bundleDrink
        ? account.bundleDrink
        : officePref.defaultDrink;

    const location = await locations.findOne({ _id: officePref.defaultLocationId });
    if (!location) {
      summary.skipped.push({ membershipId: memId, reason: "no_office_location" });
      continue;
    }

    const result = selectVendor(
      {
        preferredVendorId: officePref.preferredVendorId ?? null,
        point: location.geo,
        date: localDate,
        weekday,
        time: officePref.schedule.time,
        drink: { drink: drink.drink, milk: drink.milk },
        nowLocalDate: localDateOf(now),
        nowLocalTime: localTimeOf(now),
      },
      routingCandidates,
    );
    if (!result.ok) {
      summary.skipped.push({ membershipId: memId, reason: result.reason });
      continue;
    }

    const candidate = candidateByVendor.get(result.vendorId.toHexString())!;
    const order = buildOfficeOrder({
      membership,
      drink,
      schedule: officePref.schedule,
      location,
      vendor: candidate.vendor,
      assignmentMethod: result.method,
      priceSen: vendorDrinkPriceSen(candidate.menuItems, drink.drink),
      localDate,
      now,
    });
    // Phase K.2: individual office coffees get the vendor's time-window discount
    // too (pack-covered coffees are created at cutoff and never reach here).
    applyTimeWindowDiscountToOrder(
      order,
      timeWindowDiscounts.get(candidate.vendor._id.toHexString()) ?? [],
      weekday,
      officePref.schedule.time,
    );

    try {
      await orders.insertOne(order);
      summary.generated += 1;
      candidate.assignedCount += 1;
      const hour = deliveryHourOf(officePref.schedule.time);
      candidate.assignedByHour[hour] = (candidate.assignedByHour[hour] ?? 0) + 1;
      await emitOrderEvent("order.scheduled", order, now, {
        vendorExternalIdHint: candidate.vendor.externalId,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        summary.duplicates += 1;
      } else {
        throw error;
      }
    }
  }

  return summary;
}
