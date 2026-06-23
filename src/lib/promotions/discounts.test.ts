import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import {
  applyDiscount,
  bestTimeWindowDiscount,
  type TimeWindowPromo,
} from "@/lib/promotions/discounts";

function promo(over: Partial<TimeWindowPromo>): TimeWindowPromo {
  return {
    vendorPromotionId: new ObjectId(),
    discountPct: 50,
    windowStart: "14:00",
    windowEnd: "16:00",
    applicableDays: [1, 2, 3, 4, 5],
    ...over,
  };
}

describe("applyDiscount", () => {
  it("rounds to the nearest sen and never goes negative", () => {
    expect(applyDiscount(1000, 50)).toBe(500);
    expect(applyDiscount(999, 50)).toBe(500); // 499.5 → 500
    expect(applyDiscount(1000, 100)).toBe(0);
    expect(applyDiscount(1000, 1)).toBe(990);
  });
});

describe("bestTimeWindowDiscount", () => {
  it("returns null when no promo matches the day", () => {
    expect(bestTimeWindowDiscount([promo({ applicableDays: [6, 7] })], 1, "15:00")).toBeNull();
  });

  it("returns null outside the window (inclusive bounds)", () => {
    const p = [promo({})];
    expect(bestTimeWindowDiscount(p, 1, "13:59")).toBeNull();
    expect(bestTimeWindowDiscount(p, 1, "16:01")).toBeNull();
    expect(bestTimeWindowDiscount(p, 1, "14:00")).not.toBeNull();
    expect(bestTimeWindowDiscount(p, 1, "16:00")).not.toBeNull();
  });

  it("picks the largest applicable discount", () => {
    const small = promo({ discountPct: 20 });
    const big = promo({ discountPct: 60 });
    expect(bestTimeWindowDiscount([small, big], 3, "15:00")?.discountPct).toBe(60);
  });
});
