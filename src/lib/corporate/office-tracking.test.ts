import { describe, expect, it } from "vitest";

import { isLiveTrackable, officeTrackingStatusLabel } from "@/lib/corporate/office-tracking";

describe("isLiveTrackable", () => {
  it("is true only while out for delivery (there's a live driver/map)", () => {
    expect(isLiveTrackable("out_for_delivery")).toBe(true);
    for (const status of [
      "scheduled",
      "confirmed",
      "preparing",
      "delivered",
      "skipped",
      "failed",
    ] as const) {
      expect(isLiveTrackable(status)).toBe(false);
    }
  });
});

describe("officeTrackingStatusLabel", () => {
  it("gives compact member-facing copy for each status", () => {
    expect(officeTrackingStatusLabel("preparing")).toBe("Being made");
    expect(officeTrackingStatusLabel("out_for_delivery")).toBe("On its way");
    expect(officeTrackingStatusLabel("delivered")).toBe("Delivered");
    expect(officeTrackingStatusLabel("failed")).toBe("Didn't arrive");
  });
});
