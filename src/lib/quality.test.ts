import { describe, expect, it } from "vitest";

import {
  computeDerivedQuality,
  isOnTime,
  qualityScore,
  rate,
  type VendorQualityCounters,
} from "@/lib/quality";

const ZERO: VendorQualityCounters = {
  ratingSum: 0,
  ratingCount: 0,
  acceptedCount: 0,
  declinedCount: 0,
  deliveredCount: 0,
  onTimeCount: 0,
};

describe("isOnTime", () => {
  const deliverAt = new Date("2026-06-15T00:00:00Z");
  it("is on time at or within the 15-minute grace", () => {
    expect(isOnTime(new Date("2026-06-15T00:00:00Z"), deliverAt)).toBe(true);
    expect(isOnTime(new Date("2026-06-15T00:15:00Z"), deliverAt)).toBe(true);
  });
  it("is late past the grace", () => {
    expect(isOnTime(new Date("2026-06-15T00:15:01Z"), deliverAt)).toBe(false);
  });
});

describe("rate", () => {
  it("divides, or returns null without a denominator", () => {
    expect(rate(3, 4)).toBe(0.75);
    expect(rate(0, 0)).toBeNull();
  });
});

describe("qualityScore", () => {
  it("is neutral with no signals", () => {
    expect(qualityScore({})).toBe(0.5);
  });
  it("averages available signals (rating normalised to 0–1)", () => {
    expect(qualityScore({ ratingScore: 5 })).toBe(1);
    expect(qualityScore({ ratingScore: 4, acceptanceRate: 1, onTimeRate: 1 })).toBeCloseTo(
      (0.8 + 1 + 1) / 3,
    );
  });
});

describe("computeDerivedQuality", () => {
  it("derives rates from counters", () => {
    const d = computeDerivedQuality({
      ...ZERO,
      ratingSum: 18,
      ratingCount: 5,
      acceptedCount: 8,
      declinedCount: 2,
      deliveredCount: 10,
      onTimeCount: 9,
    });
    expect(d.ratingScore).toBe(3.6);
    expect(d.acceptanceRate).toBe(0.8);
    expect(d.onTimeRate).toBe(0.9);
    expect(d.suspend).toBe(false);
  });

  it("does not suspend below threshold until the sample floor is met", () => {
    // Rating 1.0 but only 4 ratings (< 5) → no suspend yet.
    const thin = computeDerivedQuality({ ...ZERO, ratingSum: 4, ratingCount: 4 });
    expect(thin.suspend).toBe(false);
    // 5th terrible rating crosses the floor.
    const enough = computeDerivedQuality({ ...ZERO, ratingSum: 5, ratingCount: 5 });
    expect(enough).toMatchObject({ suspend: true, reason: "low_rating" });
  });

  it("suspends on low acceptance once enough assignments", () => {
    const d = computeDerivedQuality({ ...ZERO, acceptedCount: 5, declinedCount: 5 }); // 50% of 10
    expect(d).toMatchObject({ suspend: true, reason: "low_acceptance" });
  });

  it("suspends on low on-time once enough deliveries", () => {
    const d = computeDerivedQuality({ ...ZERO, deliveredCount: 10, onTimeCount: 5 }); // 50%
    expect(d).toMatchObject({ suspend: true, reason: "low_ontime" });
  });

  it("rating takes precedence in the reason", () => {
    const d = computeDerivedQuality({
      ...ZERO,
      ratingSum: 5,
      ratingCount: 5, // 1.0
      acceptedCount: 5,
      declinedCount: 5, // also low
    });
    expect(d.reason).toBe("low_rating");
  });
});
