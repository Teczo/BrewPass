import type { ObjectId } from "mongodb";

import type { GeoPoint, Vendor } from "@/lib/models";
import { vendorCoversDrink, type CoverageItem } from "@/lib/menu";
import { distanceKm } from "@/lib/order-engine/logic";

/**
 * The Phase D routing engine — pure and deterministic, unit-tested here.
 * The orchestration layer (engine.ts) loads candidates from the database
 * and snapshots the result; this module only decides. Server-authoritative
 * (critical rule #2): clients never pick the fulfilling vendor.
 *
 * Selection order (locked product decision #2):
 *   1. The subscriber's confirmed preferred vendor, when it's eligible.
 *   2. Otherwise auto-route to the best eligible vendor — nearest first,
 *      vendor rating breaks ties.
 * Eligible = active, in service area, open at the delivery time, under
 * daily capacity, and able to make the drink.
 */

export type AssignmentMethod = "user_preferred" | "ai_routed";

export interface RoutingCandidate {
  vendor: Vendor;
  /** This vendor's published menu items (empty = offers the full menu). */
  menuItems: CoverageItem[];
  /** Orders already assigned to this vendor for the target date. */
  assignedCount: number;
}

export interface RoutingRequest {
  /** Confirmed preferred vendor, or null to always auto-route. */
  preferredVendorId: ObjectId | null;
  /** Delivery point — the order's location. */
  point: GeoPoint;
  /** ISO weekday (1–7) and HH:mm of the delivery. */
  weekday: number;
  time: string;
  /** Drink coverage check uses the taxonomy values on the spec. */
  drink: { drink: string; milk: string };
  /** Vendors to exclude (e.g. ones that already declined this order). */
  excludeVendorIds?: ObjectId[];
}

export type RoutingResult =
  | { ok: true; vendorId: ObjectId; method: AssignmentMethod }
  | { ok: false; reason: "no_vendor_available" };

/** Whether the vendor is open at a given weekday + HH:mm. Unset hours =
 * always open (v1-migrated vendors). HH:mm strings compare correctly. */
export function isVendorOpenAt(
  operatingHours: Vendor["operatingHours"],
  weekday: number,
  time: string,
): boolean {
  if (!operatingHours) return true;
  const window = operatingHours.find((w) => w.day === weekday);
  if (!window) return false;
  return time >= window.open && time < window.close;
}

/** Whether the delivery point is inside the vendor's service area. Unset
 * radius = unbounded (v1-migrated vendors). */
export function isWithinServiceArea(vendor: Vendor, point: GeoPoint): boolean {
  if (vendor.serviceAreaRadiusKm === undefined) return true;
  return distanceKm(vendor.geo, point) <= vendor.serviceAreaRadiusKm;
}

function isUnderCapacity(candidate: RoutingCandidate): boolean {
  const cap = candidate.vendor.dailyCapacity;
  return cap === undefined || candidate.assignedCount < cap;
}

/** All eligibility gates except the preferred/exclude bookkeeping. */
export function isEligible(candidate: RoutingCandidate, request: RoutingRequest): boolean {
  const { vendor } = candidate;
  return (
    vendor.status === "active" &&
    isWithinServiceArea(vendor, request.point) &&
    isVendorOpenAt(vendor.operatingHours, request.weekday, request.time) &&
    isUnderCapacity(candidate) &&
    vendorCoversDrink(candidate.menuItems, request.drink.drink, request.drink.milk)
  );
}

/** Eligible candidates ordered nearest-first, rating as tiebreak, then a
 * stable id sort so the choice is deterministic across runs. */
export function rankCandidates(
  candidates: RoutingCandidate[],
  point: GeoPoint,
): RoutingCandidate[] {
  return [...candidates].sort((a, b) => {
    const distanceDelta = distanceKm(a.vendor.geo, point) - distanceKm(b.vendor.geo, point);
    if (Math.abs(distanceDelta) > 1e-9) return distanceDelta;
    const ratingDelta = (b.vendor.ratingScore ?? 0) - (a.vendor.ratingScore ?? 0);
    if (ratingDelta !== 0) return ratingDelta;
    return a.vendor._id.toHexString().localeCompare(b.vendor._id.toHexString());
  });
}

/** Decide which vendor fulfils an order, or report that none can. */
export function selectVendor(
  request: RoutingRequest,
  candidates: RoutingCandidate[],
): RoutingResult {
  const excluded = new Set((request.excludeVendorIds ?? []).map((id) => id.toHexString()));
  const eligible = candidates.filter(
    (candidate) =>
      !excluded.has(candidate.vendor._id.toHexString()) && isEligible(candidate, request),
  );

  // Preferred vendor wins when it's among the eligible set.
  if (request.preferredVendorId) {
    const preferredHex = request.preferredVendorId.toHexString();
    const preferred = eligible.find((c) => c.vendor._id.toHexString() === preferredHex);
    if (preferred) {
      return { ok: true, vendorId: preferred.vendor._id, method: "user_preferred" };
    }
  }

  const [best] = rankCandidates(eligible, request.point);
  if (!best) return { ok: false, reason: "no_vendor_available" };
  return { ok: true, vendorId: best.vendor._id, method: "ai_routed" };
}
