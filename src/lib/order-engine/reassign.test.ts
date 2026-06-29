import { describe, expect, it } from "vitest";

import { vendorWentOffline } from "@/lib/order-engine/reassign";

describe("vendorWentOffline (Phase O.2 §2.5 trigger)", () => {
  it("fires on active → a non-serving state", () => {
    expect(vendorWentOffline("active", "paused")).toBe(true);
    expect(vendorWentOffline("active", "offline")).toBe(true);
    expect(vendorWentOffline("active", "suspended")).toBe(true);
  });

  it("does not fire when leaving a state that was already non-serving", () => {
    // Earlier transitions already rescued any charged orders.
    expect(vendorWentOffline("paused", "suspended")).toBe(false);
    expect(vendorWentOffline("offline", "paused")).toBe(false);
  });

  it("does not fire on no-op or re-activation transitions", () => {
    expect(vendorWentOffline("active", "active")).toBe(false);
    expect(vendorWentOffline("paused", "active")).toBe(false);
    expect(vendorWentOffline("active", "rejected")).toBe(false); // not an operational transition
  });
});
