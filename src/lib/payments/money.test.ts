import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import {
  buildPayoutBatch,
  effectiveCommissionBps,
  PLATFORM_DEFAULT_COMMISSION_BPS,
  splitOrderAmount,
} from "@/lib/payments/money";

describe("effectiveCommissionBps", () => {
  it("uses the vendor override when set", () => {
    expect(effectiveCommissionBps(2000, 1500)).toBe(1500);
    expect(effectiveCommissionBps(2000, 0)).toBe(0); // 0% override is honoured
  });

  it("falls back to the platform default when unset", () => {
    expect(effectiveCommissionBps(2000, null)).toBe(2000);
    expect(effectiveCommissionBps(2000, undefined)).toBe(2000);
  });
});

describe("splitOrderAmount", () => {
  it("splits at the default 20% commission", () => {
    const split = splitOrderAmount(1500, PLATFORM_DEFAULT_COMMISSION_BPS);
    expect(split.commissionSen).toBe(300);
    expect(split.vendorNetSen).toBe(1200);
    expect(split.commissionSen + split.vendorNetSen).toBe(1500);
  });

  it("rounds commission down so the vendor keeps the remainder", () => {
    // 1299 * 20% = 259.8 → commission floors to 259, vendor gets 1040.
    const split = splitOrderAmount(1299, 2000);
    expect(split.commissionSen).toBe(259);
    expect(split.vendorNetSen).toBe(1040);
    expect(split.commissionSen + split.vendorNetSen).toBe(1299);
  });

  it("handles the 0% and 100% edges", () => {
    expect(splitOrderAmount(1500, 0)).toMatchObject({ commissionSen: 0, vendorNetSen: 1500 });
    expect(splitOrderAmount(1500, 10000)).toMatchObject({ commissionSen: 1500, vendorNetSen: 0 });
  });

  it("rejects invalid inputs", () => {
    expect(() => splitOrderAmount(-1, 2000)).toThrow();
    expect(() => splitOrderAmount(10.5, 2000)).toThrow();
    expect(() => splitOrderAmount(1500, 12000)).toThrow();
    expect(() => splitOrderAmount(1500, -100)).toThrow();
  });
});

describe("buildPayoutBatch", () => {
  it("sums gross, commission, and net across lines", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const batch = buildPayoutBatch([
      { orderId: a, grossSen: 1500, commissionSen: 300, vendorNetSen: 1200 },
      { orderId: b, grossSen: 1299, commissionSen: 259, vendorNetSen: 1040 },
    ]);
    expect(batch.orderIds).toEqual([a, b]);
    expect(batch.grossSen).toBe(2799);
    expect(batch.commissionSen).toBe(559);
    expect(batch.netSen).toBe(2240);
  });

  it("is empty for no lines", () => {
    expect(buildPayoutBatch([])).toEqual({
      orderIds: [],
      grossSen: 0,
      commissionSen: 0,
      netSen: 0,
    });
  });
});
