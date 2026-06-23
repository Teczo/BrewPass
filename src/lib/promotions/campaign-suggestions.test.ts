import { describe, expect, it } from "vitest";

import {
  blockIndexOf,
  CORP_SHARE_FOR_PACK,
  MIN_ORDERS_FOR_PACK,
  MIN_ORDERS_FOR_TIME_WINDOW,
  SUGGESTED_DISCOUNT_PCT,
  suggestCampaigns,
  type ActivePromoSummary,
  type DeliveredOrderObservation,
} from "@/lib/promotions/campaign-suggestions";

/** n delivered observations on a given weekday/hour/source. */
function obs(
  weekday: number,
  hour: number,
  count: number,
  source: "personal" | "corporate" = "personal",
): DeliveredOrderObservation[] {
  return Array.from({ length: count }, () => ({ weekday, hour, source }));
}

describe("blockIndexOf", () => {
  it("buckets daytime hours into two-hour blocks", () => {
    expect(blockIndexOf(7)).toBe(0);
    expect(blockIndexOf(8)).toBe(0);
    expect(blockIndexOf(9)).toBe(1);
    expect(blockIndexOf(13)).toBe(3);
  });

  it("rejects hours outside daytime", () => {
    expect(blockIndexOf(6)).toBeNull();
    expect(blockIndexOf(19)).toBeNull();
    expect(blockIndexOf(23)).toBeNull();
  });
});

describe("suggestCampaigns — time-window discount", () => {
  it("suggests a discount for the quietest operating slot", () => {
    // Busy Mon–Thu mornings (block 1: 9–11), thin Friday morning.
    const observations = [
      ...obs(1, 9, 10),
      ...obs(2, 9, 10),
      ...obs(3, 9, 10),
      ...obs(4, 9, 10),
      ...obs(5, 9, 1), // Friday morning is the lone quiet slot
    ];

    const result = suggestCampaigns({ observations, activePromotions: [] });
    const tw = result.find((s) => s.kind === "time_window_discount");
    expect(tw).toBeDefined();
    expect(tw?.prefill).toMatchObject({
      type: "time_window_discount",
      discountPct: SUGGESTED_DISCOUNT_PCT,
      windowStart: "09:00",
      windowEnd: "11:00",
      applicableDays: [5],
    });
    expect(tw?.title).toContain("Friday");
  });

  it("never suggests a slot the vendor doesn't serve (closed weekday/block)", () => {
    // Only Monday mornings: a single eligible cell, nothing to compare.
    const result = suggestCampaigns({
      observations: obs(1, 9, MIN_ORDERS_FOR_TIME_WINDOW + 5),
      activePromotions: [],
    });
    expect(result.find((s) => s.kind === "time_window_discount")).toBeUndefined();
  });

  it("stays quiet on thin history", () => {
    const result = suggestCampaigns({
      observations: [...obs(1, 9, 3), ...obs(2, 15, 1)],
      activePromotions: [],
    });
    expect(result.find((s) => s.kind === "time_window_discount")).toBeUndefined();
  });

  it("does not suggest when load is even (no clearly quiet slot)", () => {
    const observations = [...obs(1, 9, 10), ...obs(2, 9, 10), ...obs(1, 15, 10), ...obs(2, 15, 10)];
    const result = suggestCampaigns({ observations, activePromotions: [] });
    expect(result.find((s) => s.kind === "time_window_discount")).toBeUndefined();
  });

  it("skips a slot already covered by an active time-window discount", () => {
    const observations = [
      ...obs(1, 9, 10),
      ...obs(2, 9, 10),
      ...obs(3, 9, 10),
      ...obs(4, 9, 10),
      ...obs(5, 9, 1),
    ];
    const active: ActivePromoSummary[] = [
      {
        type: "time_window_discount",
        applicableDays: [5],
        windowStart: "09:00",
        windowEnd: "11:00",
      },
    ];
    const result = suggestCampaigns({ observations, activePromotions: active });
    expect(result.find((s) => s.kind === "time_window_discount")).toBeUndefined();
  });

  it("still suggests when an active discount covers a different day", () => {
    const observations = [
      ...obs(1, 9, 10),
      ...obs(2, 9, 10),
      ...obs(3, 9, 10),
      ...obs(4, 9, 10),
      ...obs(5, 9, 1),
    ];
    const active: ActivePromoSummary[] = [
      {
        type: "time_window_discount",
        applicableDays: [1],
        windowStart: "09:00",
        windowEnd: "11:00",
      },
    ];
    const result = suggestCampaigns({ observations, activePromotions: active });
    expect(result.find((s) => s.kind === "time_window_discount")).toBeDefined();
  });
});

describe("suggestCampaigns — vendor pack", () => {
  const busyMixed = (corporateCount: number, personalCount: number) => [
    ...obs(1, 9, corporateCount, "corporate"),
    ...obs(2, 9, personalCount, "personal"),
  ];

  it("suggests a pack when offices are a meaningful share and none is running", () => {
    const result = suggestCampaigns({
      observations: busyMixed(MIN_ORDERS_FOR_PACK, 10),
      activePromotions: [],
    });
    const pack = result.find((s) => s.kind === "pack");
    expect(pack).toBeDefined();
    expect(pack?.prefill).toMatchObject({ type: "pack", packMode: "buyer_choice" });
  });

  it("does not suggest a pack when one is already active", () => {
    const result = suggestCampaigns({
      observations: busyMixed(MIN_ORDERS_FOR_PACK, 10),
      activePromotions: [{ type: "pack" }],
    });
    expect(result.find((s) => s.kind === "pack")).toBeUndefined();
  });

  it("does not suggest a pack when office share is below threshold", () => {
    // Few corporate among many personal — below CORP_SHARE_FOR_PACK.
    const corporate = 2;
    const personal = Math.ceil(corporate / CORP_SHARE_FOR_PACK) + 20;
    const result = suggestCampaigns({
      observations: busyMixed(corporate, personal),
      activePromotions: [],
    });
    expect(result.find((s) => s.kind === "pack")).toBeUndefined();
  });

  it("does not suggest a pack on thin history", () => {
    const result = suggestCampaigns({
      observations: obs(1, 9, 5, "corporate"),
      activePromotions: [],
    });
    expect(result.find((s) => s.kind === "pack")).toBeUndefined();
  });
});
