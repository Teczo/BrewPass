import { describe, expect, it } from "vitest";

import { operatingHoursSchema, vendorStatusSchema, type VendorStatus } from "@/lib/models/vendor";
import { canAdminSetStatus, canVendorSetStatus } from "@/lib/vendor-rules";

const ALL_STATUSES = vendorStatusSchema.options;
const OPERATIONAL: VendorStatus[] = ["active", "paused", "offline"];
const APPLICATION: VendorStatus[] = ["pending", "rejected"];

describe("canVendorSetStatus", () => {
  it("lets operational vendors move freely between active/paused/offline", () => {
    for (const from of OPERATIONAL) {
      for (const to of OPERATIONAL) {
        expect(canVendorSetStatus(from, to)).toBe(true);
      }
    }
  });

  it("never lets a vendor leave pending, rejected, or suspended", () => {
    for (const from of ["pending", "rejected", "suspended"] as const) {
      for (const to of ALL_STATUSES) {
        expect(canVendorSetStatus(from, to)).toBe(false);
      }
    }
  });

  it("never lets a vendor suspend themselves or re-enter application states", () => {
    for (const from of OPERATIONAL) {
      for (const to of ["pending", "rejected", "suspended"] as const) {
        expect(canVendorSetStatus(from, to)).toBe(false);
      }
    }
  });
});

describe("canAdminSetStatus", () => {
  it("lets admins move operational vendors anywhere operational, incl. suspension", () => {
    for (const from of [...OPERATIONAL, "suspended" as const]) {
      for (const to of [...OPERATIONAL, "suspended" as const]) {
        expect(canAdminSetStatus(from, to)).toBe(true);
      }
    }
  });

  it("keeps applications out of direct status control (review flow only)", () => {
    for (const application of APPLICATION) {
      for (const other of ALL_STATUSES) {
        expect(canAdminSetStatus(application, other)).toBe(false);
        expect(canAdminSetStatus(other, application)).toBe(false);
      }
    }
  });
});

describe("operatingHoursSchema", () => {
  it("accepts a normal week", () => {
    const result = operatingHoursSchema.safeParse([
      { day: 1, open: "08:00", close: "18:00" },
      { day: 6, open: "09:30", close: "13:00" },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts an empty list (always-open migrated vendors)", () => {
    expect(operatingHoursSchema.safeParse([]).success).toBe(true);
  });

  it("rejects windows that close before they open (or never open)", () => {
    expect(
      operatingHoursSchema.safeParse([{ day: 1, open: "18:00", close: "08:00" }]).success,
    ).toBe(false);
    expect(
      operatingHoursSchema.safeParse([{ day: 1, open: "08:00", close: "08:00" }]).success,
    ).toBe(false);
  });

  it("rejects duplicate days", () => {
    expect(
      operatingHoursSchema.safeParse([
        { day: 1, open: "08:00", close: "12:00" },
        { day: 1, open: "14:00", close: "18:00" },
      ]).success,
    ).toBe(false);
  });

  it("rejects out-of-range days and malformed times", () => {
    expect(
      operatingHoursSchema.safeParse([{ day: 8, open: "08:00", close: "18:00" }]).success,
    ).toBe(false);
    expect(operatingHoursSchema.safeParse([{ day: 1, open: "8am", close: "18:00" }]).success).toBe(
      false,
    );
  });
});
