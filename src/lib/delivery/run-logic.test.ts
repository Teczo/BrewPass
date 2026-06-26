import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import {
  deriveRunStatus,
  groupOrdersIntoStops,
  validateRunComposition,
  type RunOrderView,
} from "@/lib/delivery/run-logic";
import type { OrderStatus } from "@/lib/models";

function order(overrides: Partial<RunOrderView> = {}): RunOrderView {
  return {
    orderId: new ObjectId(),
    vendorId: new ObjectId(),
    status: "confirmed",
    locationId: new ObjectId(),
    ...overrides,
  };
}

/** A shared drop — every order in a run is delivered to the same place. */
const drop = new ObjectId();

describe("validateRunComposition (L.1)", () => {
  it("accepts ≥2 deliverable orders sharing one drop", () => {
    const orders = [order({ locationId: drop }), order({ locationId: drop, status: "preparing" })];
    expect(validateRunComposition(orders)).toEqual({ ok: true });
  });

  it("rejects an empty set", () => {
    expect(validateRunComposition([])).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a single order — that's an ordinary single-vendor delivery", () => {
    expect(validateRunComposition([order({ locationId: drop })])).toEqual({
      ok: false,
      reason: "single_order",
    });
  });

  it("rejects Pack orders (rule #22 — a Pack is single-vendor and never reroutes)", () => {
    const orders = [
      order({ locationId: drop }),
      order({ locationId: drop, packPurchaseId: new ObjectId() }),
    ];
    expect(validateRunComposition(orders)).toEqual({
      ok: false,
      reason: "contains_pack_order",
    });
  });

  it("rejects orders already grouped into another run", () => {
    const orders = [
      order({ locationId: drop }),
      order({ locationId: drop, deliveryRunId: new ObjectId() }),
    ];
    expect(validateRunComposition(orders)).toEqual({ ok: false, reason: "already_in_run" });
  });

  it("rejects a mixed drop location — a run is ONE delivery to ONE place", () => {
    const orders = [order({ locationId: drop }), order({ locationId: new ObjectId() })];
    expect(validateRunComposition(orders)).toEqual({
      ok: false,
      reason: "mixed_drop_location",
    });
  });

  it("rejects orders not in a combinable state (e.g. already delivered/scheduled)", () => {
    const orders = [order({ locationId: drop }), order({ locationId: drop, status: "delivered" })];
    expect(validateRunComposition(orders)).toEqual({
      ok: false,
      reason: "uncombinable_status",
    });
  });
});

describe("groupOrdersIntoStops (L.1)", () => {
  it("groups orders by vendor, preserving first-seen route order", () => {
    const cafeA = new ObjectId();
    const cafeB = new ObjectId();
    const a1 = order({ vendorId: cafeA });
    const b1 = order({ vendorId: cafeB });
    const a2 = order({ vendorId: cafeA });

    const stops = groupOrdersIntoStops([a1, b1, a2]);

    expect(stops).toHaveLength(2);
    expect(stops[0].vendorId).toBe(cafeA);
    expect(stops[0].orderIds).toEqual([a1.orderId, a2.orderId]);
    expect(stops[1].vendorId).toBe(cafeB);
    expect(stops[1].orderIds).toEqual([b1.orderId]);
  });

  it("makes one stop per vendor when each order is a different café", () => {
    const orders = [order(), order(), order()];
    const stops = groupOrdersIntoStops(orders);
    expect(stops).toHaveLength(3);
    expect(stops.every((s) => s.orderIds.length === 1)).toBe(true);
  });
});

describe("deriveRunStatus (L.2)", () => {
  const statuses = (...s: OrderStatus[]) => s;

  it("is completed when every order was delivered", () => {
    expect(deriveRunStatus(statuses("delivered", "delivered"))).toBe("completed");
  });

  it("is failed when every order failed or was skipped", () => {
    expect(deriveRunStatus(statuses("failed", "skipped"))).toBe("failed");
  });

  it("is partially_failed when some delivered and the rest failed (per-order refund)", () => {
    expect(deriveRunStatus(statuses("delivered", "failed", "delivered"))).toBe("partially_failed");
  });

  it("treats a skipped order alongside a delivered one as a partial failure", () => {
    expect(deriveRunStatus(statuses("delivered", "skipped"))).toBe("partially_failed");
  });

  it("is planned while orders are still in flight and no courier job is live", () => {
    expect(deriveRunStatus(statuses("confirmed", "preparing"))).toBe("planned");
  });

  it("is dispatched while in flight once a multi-stop courier job is live", () => {
    expect(deriveRunStatus(statuses("out_for_delivery", "preparing"), { dispatched: true })).toBe(
      "dispatched",
    );
  });

  it("settles to a terminal status even if a courier job was live", () => {
    expect(deriveRunStatus(statuses("delivered", "delivered"), { dispatched: true })).toBe(
      "completed",
    );
  });
});
