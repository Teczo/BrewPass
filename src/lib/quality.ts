import type { Vendor } from "@/lib/models";

/**
 * Pure vendor-quality logic (Phase G) — deterministic and unit-tested. The
 * service layer (quality-service.ts) wraps these with database I/O.
 *
 * Quality has three signals: star rating, acceptance rate, and on-time rate.
 * They combine into a composite score that breaks routing ties (after
 * proximity), and they auto-suspend a vendor from routing when they fall
 * below threshold with enough samples ("flag + suspend"). Thresholds and
 * sample floors live here as named constants so they're easy to tune.
 */

/** On time = delivered no later than the promised time plus this grace. */
export const ONTIME_GRACE_MINUTES = 15;

/** Sample floors — don't suspend a vendor on thin data. */
export const MIN_RATINGS_FOR_FLAG = 5;
export const MIN_ASSIGNMENTS_FOR_FLAG = 10;
export const MIN_DELIVERIES_FOR_FLAG = 10;

/** Below-threshold triggers (confirmed 2026-06-15). */
export const FLAG_RATING_BELOW = 3.0;
export const FLAG_ACCEPTANCE_BELOW = 0.6;
export const FLAG_ONTIME_BELOW = 0.6;

/** Neutral composite for a vendor with no quality signal yet. */
export const NEUTRAL_QUALITY = 0.5;

/** Whether a delivery met the promised time (+ grace). */
export function isOnTime(
  deliveredAt: Date,
  deliverAt: Date,
  graceMinutes: number = ONTIME_GRACE_MINUTES,
): boolean {
  return deliveredAt.getTime() <= deliverAt.getTime() + graceMinutes * 60_000;
}

/** Safe ratio, or null when there's no denominator. */
export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export interface QualitySignals {
  ratingScore?: number | null;
  acceptanceRate?: number | null;
  onTimeRate?: number | null;
}

/**
 * Composite quality in [0,1] — the equal-weighted average of whatever signals
 * are available (rating normalised to 0–1, acceptance, on-time). A vendor with
 * no signal yet scores neutral, so quality only ever breaks near-ties and
 * never strands new vendors.
 */
export function qualityScore(signals: QualitySignals): number {
  const parts: number[] = [];
  if (signals.ratingScore != null) parts.push(signals.ratingScore / 5);
  if (signals.acceptanceRate != null) parts.push(signals.acceptanceRate);
  if (signals.onTimeRate != null) parts.push(signals.onTimeRate);
  if (parts.length === 0) return NEUTRAL_QUALITY;
  return parts.reduce((sum, part) => sum + part, 0) / parts.length;
}

/** Routing tiebreak score for a vendor, from its stored derived rates. */
export function vendorQualityScore(vendor: Vendor): number {
  return qualityScore({
    ratingScore: vendor.ratingScore,
    acceptanceRate: vendor.acceptanceRate,
    onTimeRate: vendor.onTimeRate,
  });
}

export interface VendorQualityCounters {
  ratingSum: number;
  ratingCount: number;
  acceptedCount: number;
  declinedCount: number;
  deliveredCount: number;
  onTimeCount: number;
}

export interface DerivedQuality {
  ratingScore: number | null;
  acceptanceRate: number | null;
  onTimeRate: number | null;
  /** True when metrics fall below threshold with enough samples. */
  suspend: boolean;
  /** Why suspended, or null. */
  reason: string | null;
}

/**
 * Recompute a vendor's derived rates from raw counters and decide whether
 * they should be auto-suspended from routing. A signal only triggers
 * suspension once it has cleared its sample floor.
 */
export function computeDerivedQuality(counters: VendorQualityCounters): DerivedQuality {
  const ratingScore = counters.ratingCount > 0 ? counters.ratingSum / counters.ratingCount : null;
  const assignments = counters.acceptedCount + counters.declinedCount;
  const acceptanceRate = rate(counters.acceptedCount, assignments);
  const onTimeRate = rate(counters.onTimeCount, counters.deliveredCount);

  let reason: string | null = null;
  if (
    ratingScore != null &&
    counters.ratingCount >= MIN_RATINGS_FOR_FLAG &&
    ratingScore < FLAG_RATING_BELOW
  ) {
    reason = "low_rating";
  } else if (
    acceptanceRate != null &&
    assignments >= MIN_ASSIGNMENTS_FOR_FLAG &&
    acceptanceRate < FLAG_ACCEPTANCE_BELOW
  ) {
    reason = "low_acceptance";
  } else if (
    onTimeRate != null &&
    counters.deliveredCount >= MIN_DELIVERIES_FOR_FLAG &&
    onTimeRate < FLAG_ONTIME_BELOW
  ) {
    reason = "low_ontime";
  }

  return { ratingScore, acceptanceRate, onTimeRate, suspend: reason != null, reason };
}
