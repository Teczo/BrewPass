import type { ObjectId } from "mongodb";

import type { GeoPoint, Vendor } from "@/lib/models";
import { vendorCoversDrink, type CoverageItem } from "@/lib/menu";
import { distanceKm } from "@/lib/order-engine/logic";
import { vendorQualityScore } from "@/lib/quality";

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
  /** Orders already assigned per KL delivery hour (Phase F slot caps). */
  assignedByHour: Record<number, number>;
}

export interface RoutingRequest {
  /** Confirmed preferred vendor, or null to always auto-route. */
  preferredVendorId: ObjectId | null;
  /** Delivery point — the order's location. */
  point: GeoPoint;
  /** Local delivery date (YYYY-MM-DD), ISO weekday (1–7) and HH:mm of delivery. */
  date: string;
  weekday: number;
  time: string;
  /** Drink coverage check uses the taxonomy values on the spec. */
  drink: { drink: string; milk: string };
  /** When the assignment is happening, in KL local terms — drives the
   * per-vendor accept-cutoff gate (Phase F). */
  nowLocalDate: string;
  nowLocalTime: string;
  /** Vendors to exclude (e.g. ones that already declined this order). */
  excludeVendorIds?: ObjectId[];
  /**
   * Phase O.2 §2.5 — emergency same-day reassignment of an already-charged
   * order whose vendor went offline. Bypasses the per-vendor accept-cutoff gate
   * (the rescue happens after that cutoff by definition); every other
   * eligibility check still applies.
   */
  bypassAcceptCutoff?: boolean;
}

/** The KL delivery hour (0–23) of an HH:mm time. */
export function deliveryHourOf(time: string): number {
  return Number(time.slice(0, 2));
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

/** Whether the delivery hour for this request is under the vendor's per-hour
 * cap (Phase F). Hours without a configured cap are limited only by the daily
 * cap. A cap of 0 closes that hour. */
export function isUnderSlotCap(candidate: RoutingCandidate, request: RoutingRequest): boolean {
  const slot = candidate.vendor.slotCapacities?.find(
    (s) => s.hour === deliveryHourOf(request.time),
  );
  if (!slot) return true;
  return (candidate.assignedByHour[slot.hour] ?? 0) < slot.cap;
}

/** Whether the vendor has marked the delivery date sold out (Phase F). */
export function isNotSoldOut(vendor: Vendor, date: string): boolean {
  return !vendor.soldOutDates?.includes(date);
}

/** Whether the vendor is auto-suspended from routing for poor quality
 * (Phase G "flag + suspend"). Cleared by an admin. */
export function isNotQualitySuspended(vendor: Vendor): boolean {
  return !vendor.qualitySuspendedAt;
}

/**
 * The per-vendor accept-cutoff gate (Phase F). The vendor won't take an order
 * being assigned after `orderAcceptCutoff` on the delivery day. Assignments
 * before the delivery day (night-before generation) always pass; the delivery
 * day already past never does.
 */
export function isVendorAcceptingAssignment(vendor: Vendor, request: RoutingRequest): boolean {
  // §2.5 emergency reassignment ignores the accept-cutoff (the rescue is
  // intentionally after it).
  if (request.bypassAcceptCutoff) return true;
  const cutoff = vendor.orderAcceptCutoff;
  if (!cutoff) return true;
  if (request.nowLocalDate < request.date) return true;
  if (request.nowLocalDate > request.date) return false;
  return request.nowLocalTime < cutoff;
}

/** All eligibility gates except the preferred/exclude bookkeeping. */
export function isEligible(candidate: RoutingCandidate, request: RoutingRequest): boolean {
  const { vendor } = candidate;
  return (
    vendor.status === "active" &&
    isNotQualitySuspended(vendor) &&
    isWithinServiceArea(vendor, request.point) &&
    isVendorOpenAt(vendor.operatingHours, request.weekday, request.time) &&
    isUnderCapacity(candidate) &&
    isUnderSlotCap(candidate, request) &&
    isNotSoldOut(vendor, request.date) &&
    isVendorAcceptingAssignment(vendor, request) &&
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
    // Composite quality (rating + acceptance + on-time) breaks near-ties.
    const qualityDelta = vendorQualityScore(b.vendor) - vendorQualityScore(a.vendor);
    if (Math.abs(qualityDelta) > 1e-9) return qualityDelta;
    return a.vendor._id.toHexString().localeCompare(b.vendor._id.toHexString());
  });
}

/**
 * Whether ANY active candidate's service area covers the point (Phase O.1).
 * This is the coverage-gap test that distinguishes a true cold-start gap from
 * a transient all-busy day: it ignores every transient gate (hours, capacity,
 * sold-out, accept-cutoff) and asks only "could some vendor here ever serve
 * this address?". A `false` result means the user should be waitlisted
 * (`fallbacks.md` §1.1/§1.2); a `true` result with no eligible vendor is a
 * transient miss, handled by the O.2 retry path, not the waitlist.
 */
export function hasAreaCoverage(candidates: RoutingCandidate[], point: GeoPoint): boolean {
  return candidates.some((candidate) => isWithinServiceArea(candidate.vendor, point));
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
