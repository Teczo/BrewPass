import type { ObjectId } from "mongodb";

import { vendorsCollection } from "@/lib/collections";
import { computeDerivedQuality } from "@/lib/quality";

/**
 * Vendor-quality service (Phase G): record quality events and keep the
 * derived rates + auto-suspension in sync. Raw counters are incremented
 * atomically; derived rates (ratingScore/acceptanceRate/onTimeRate) and the
 * suspend flag are recomputed from them so the aggregates are always
 * reconstructible from the counters.
 *
 * Suspension is one-way here: set when metrics cross the threshold with
 * enough samples, never auto-cleared — an admin lifts it (the chosen
 * "flag + suspend ... until an admin clears" policy).
 */

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Recompute derived rates + suspension from a vendor's current counters. */
export async function refreshVendorQuality(vendorId: ObjectId, now: Date): Promise<void> {
  const vendors = await vendorsCollection();
  const vendor = await vendors.findOne({ _id: vendorId });
  if (!vendor) return;

  const derived = computeDerivedQuality({
    ratingSum: vendor.ratingSum ?? 0,
    ratingCount: vendor.ratingCount ?? 0,
    acceptedCount: vendor.acceptedCount ?? 0,
    declinedCount: vendor.declinedCount ?? 0,
    deliveredCount: vendor.deliveredCount ?? 0,
    onTimeCount: vendor.onTimeCount ?? 0,
  });

  const set: Record<string, unknown> = { updatedAt: now };
  const unset: Record<string, ""> = {};
  if (derived.ratingScore != null) set.ratingScore = round2(derived.ratingScore);
  else unset.ratingScore = "";
  if (derived.acceptanceRate != null) set.acceptanceRate = round2(derived.acceptanceRate);
  else unset.acceptanceRate = "";
  if (derived.onTimeRate != null) set.onTimeRate = round2(derived.onTimeRate);
  else unset.onTimeRate = "";

  // Set the suspension only when newly triggered; never auto-clear it.
  if (derived.suspend && !vendor.qualitySuspendedAt) {
    set.qualitySuspendedAt = now;
    set.qualityFlagReason = derived.reason;
  }

  await vendors.updateOne(
    { _id: vendorId },
    { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) },
  );
}

async function bump(vendorId: ObjectId, inc: Record<string, number>, now: Date): Promise<void> {
  const vendors = await vendorsCollection();
  await vendors.updateOne({ _id: vendorId }, { $inc: inc, $set: { updatedAt: now } });
  await refreshVendorQuality(vendorId, now);
}

/** A subscriber rated a delivered order. */
export function recordRating(vendorId: ObjectId, score: number, now: Date = new Date()) {
  return bump(vendorId, { ratingSum: score, ratingCount: 1 }, now);
}

/** An order locked for the vendor without being declined (implicit accept). */
export function recordAcceptance(vendorId: ObjectId, now: Date = new Date()) {
  return bump(vendorId, { acceptedCount: 1 }, now);
}

/** The vendor declined an assigned order. */
export function recordDecline(vendorId: ObjectId, now: Date = new Date()) {
  return bump(vendorId, { declinedCount: 1 }, now);
}

/** An order was delivered; `onTime` from isOnTime(deliveredAt, deliverAt). */
export function recordDelivery(vendorId: ObjectId, onTime: boolean, now: Date = new Date()) {
  return bump(vendorId, { deliveredCount: 1, onTimeCount: onTime ? 1 : 0 }, now);
}
