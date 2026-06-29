import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { newDocumentMeta } from "@/lib/models";
import type { Delivery } from "@/lib/models";
import { STUCK_DELIVERY_THRESHOLD_MS, isDeliveryStuck } from "@/lib/delivery/stuck";

const now = new Date("2026-06-10T12:00:00Z");

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    orderId: new ObjectId(),
    status: "assigned",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const justOverThreshold = new Date(now.getTime() - STUCK_DELIVERY_THRESHOLD_MS - 60_000);
const wellWithinThreshold = new Date(now.getTime() - 10 * 60_000);

describe("isDeliveryStuck (Phase O.4 §5.6)", () => {
  it("is true for an in-flight delivery past the threshold", () => {
    expect(isDeliveryStuck(makeDelivery({ assignedAt: justOverThreshold }), now)).toBe(true);
    expect(
      isDeliveryStuck(makeDelivery({ status: "picked_up", pickedUpAt: justOverThreshold }), now),
    ).toBe(true);
  });

  it("is false for an in-flight delivery still within the threshold", () => {
    expect(isDeliveryStuck(makeDelivery({ assignedAt: wellWithinThreshold }), now)).toBe(false);
  });

  it("is false for terminal/not-yet-dispatched states regardless of age", () => {
    for (const status of ["pending", "delivered", "failed"] as const) {
      expect(isDeliveryStuck(makeDelivery({ status, assignedAt: justOverThreshold }), now)).toBe(
        false,
      );
    }
  });

  it("prefers the most specific in-flight timestamp (pickedUpAt over assignedAt)", () => {
    // Assigned long ago, but picked up recently → not stuck (clock resets at pickup).
    const delivery = makeDelivery({
      status: "picked_up",
      assignedAt: justOverThreshold,
      pickedUpAt: wellWithinThreshold,
    });
    expect(isDeliveryStuck(delivery, now)).toBe(false);
  });

  it("falls back to createdAt when no in-flight timestamp is set", () => {
    expect(isDeliveryStuck(makeDelivery({ createdAt: justOverThreshold }), now)).toBe(true);
  });
});
