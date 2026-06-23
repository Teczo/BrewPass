import { describe, expect, it } from "vitest";

import {
  allocatePackAmounts,
  distributeEvenly,
  effectivePackSize,
  isPromotionActiveOn,
  resolvePackCommissionBps,
  validateAssignmentCount,
  vendorAvailableForPinnedPack,
} from "@/lib/promotions/pack-math";

describe("distributeEvenly", () => {
  it("splits exactly, spreading the remainder to the earliest parts", () => {
    expect(distributeEvenly(100, 4)).toEqual([25, 25, 25, 25]);
    expect(distributeEvenly(101, 4)).toEqual([26, 25, 25, 25]);
    expect(distributeEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(distributeEvenly(0, 3)).toEqual([0, 0, 0]);
  });

  it("always sums to the total", () => {
    for (const [total, n] of [
      [1234, 7],
      [9999, 10],
      [5, 5],
    ] as const) {
      const parts = distributeEvenly(total, n);
      expect(parts).toHaveLength(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("rejects bad inputs", () => {
    expect(() => distributeEvenly(-1, 2)).toThrow();
    expect(() => distributeEvenly(10, 0)).toThrow();
  });
});

describe("allocatePackAmounts", () => {
  it("returns nothing for zero assigned slots", () => {
    expect(allocatePackAmounts(10000, 2000, 0)).toEqual([]);
  });

  it("allocates gross + commission across assigned slots, summing to the pack total", () => {
    // RM100 pack, 20% commission (2000 bps), 3 assigned coffees.
    const slots = allocatePackAmounts(10000, 2000, 3);
    expect(slots).toHaveLength(3);
    const gross = slots.reduce((a, s) => a + s.grossSen, 0);
    const commission = slots.reduce((a, s) => a + s.commissionSen, 0);
    const net = slots.reduce((a, s) => a + s.vendorNetSen, 0);
    expect(gross).toBe(10000);
    expect(commission).toBe(2000); // 20% of 10000
    expect(net).toBe(8000);
    // Each slot's net is its own gross minus its own commission.
    for (const s of slots) expect(s.vendorNetSen).toBe(s.grossSen - s.commissionSen);
  });

  it("never loses a sen on indivisible splits", () => {
    const slots = allocatePackAmounts(10001, 2000, 7);
    expect(slots.reduce((a, s) => a + s.grossSen, 0)).toBe(10001);
    expect(slots.reduce((a, s) => a + s.vendorNetSen + s.commissionSen, 0)).toBe(10001);
  });
});

describe("resolvePackCommissionBps", () => {
  it("uses the promo override when set, else the vendor/platform rate", () => {
    expect(resolvePackCommissionBps(1500, 2000)).toBe(1500);
    expect(resolvePackCommissionBps(null, 2000)).toBe(2000);
    expect(resolvePackCommissionBps(undefined, 2000)).toBe(2000);
    expect(resolvePackCommissionBps(0, 2000)).toBe(0); // an explicit 0% override sticks
  });
});

describe("validateAssignmentCount", () => {
  it("requires at least one and never more than the pack size", () => {
    expect(validateAssignmentCount(10, 0)).toEqual({ ok: false, reason: "no_assignments" });
    expect(validateAssignmentCount(10, 1)).toEqual({ ok: true });
    expect(validateAssignmentCount(10, 10)).toEqual({ ok: true });
    expect(validateAssignmentCount(10, 11)).toEqual({ ok: false, reason: "exceeds_pack_size" });
  });
});

describe("effectivePackSize (K.2 — bundles reuse the pack flow)", () => {
  it("uses packSize for a pack and buyQty+freeQty for a bundle", () => {
    expect(effectivePackSize({ type: "pack", packSize: 10 })).toBe(10);
    expect(effectivePackSize({ type: "buy_n_get_m", buyQty: 4, freeQty: 1 })).toBe(5);
    expect(effectivePackSize({ type: "buy_n_get_m", buyQty: 4 })).toBeNull();
    expect(effectivePackSize({ type: "time_window_discount" })).toBeNull();
  });
});

describe("isPromotionActiveOn", () => {
  const base = { status: "active", validFrom: "2026-06-01", validUntil: "2026-06-07" };
  it("is true only when active and within the inclusive window", () => {
    expect(isPromotionActiveOn(base, "2026-06-01")).toBe(true);
    expect(isPromotionActiveOn(base, "2026-06-07")).toBe(true);
    expect(isPromotionActiveOn(base, "2026-05-31")).toBe(false);
    expect(isPromotionActiveOn(base, "2026-06-08")).toBe(false);
    expect(isPromotionActiveOn({ ...base, status: "paused" }, "2026-06-03")).toBe(false);
  });
});

describe("vendorAvailableForPinnedPack (rule #20 — no reroute)", () => {
  it("requires an active vendor that isn't sold out that day", () => {
    expect(vendorAvailableForPinnedPack({ status: "active" }, "2026-06-03")).toBe(true);
    expect(vendorAvailableForPinnedPack({ status: "offline" }, "2026-06-03")).toBe(false);
    expect(vendorAvailableForPinnedPack({ status: "suspended" }, "2026-06-03")).toBe(false);
    expect(
      vendorAvailableForPinnedPack(
        { status: "active", soldOutDates: ["2026-06-03"] },
        "2026-06-03",
      ),
    ).toBe(false);
  });
});
