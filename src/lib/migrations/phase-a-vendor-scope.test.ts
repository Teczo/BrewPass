import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { cafeToVendor, vendorToCafe, type LegacyCafe } from "@/lib/migrations/phase-a-vendor-scope";
import type { Vendor } from "@/lib/models";

const createdAt = new Date("2026-01-15T03:00:00Z");
const updatedAt = new Date("2026-05-20T09:30:00Z");

function makeCafe(overrides: Partial<LegacyCafe> = {}): LegacyCafe {
  return {
    _id: new ObjectId(),
    name: "Kopi Corner",
    address: "Jalan Sultan Ismail, KL",
    geo: { lat: 3.14, lng: 101.69 },
    capabilities: ["oat_milk", "cold_brew"],
    capacityPerHour: 30,
    portalUserSubs: ["auth0|owner", "auth0|barista"],
    active: true,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

describe("cafeToVendor", () => {
  it("maps every v1 field and keeps the _id so order references stay valid", () => {
    const cafe = makeCafe();
    const vendor = cafeToVendor(cafe);

    expect(vendor._id.equals(cafe._id)).toBe(true);
    expect(vendor.businessName).toBe("Kopi Corner");
    expect(vendor.status).toBe("active");
    expect(vendor.address).toBe(cafe.address);
    expect(vendor.geo).toEqual(cafe.geo);
    expect(vendor.capabilities).toEqual(cafe.capabilities);
    expect(vendor.capacityPerHour).toBe(30);
    expect(vendor.portalUserSubs).toEqual(cafe.portalUserSubs);
    expect(vendor.createdAt).toBe(createdAt);
    expect(vendor.updatedAt).toBe(updatedAt);
    // Migrated vendors are platform-managed until Phase B onboarding.
    expect(vendor.ownerUserId).toBeUndefined();
  });

  it("maps active: false to a paused vendor", () => {
    expect(cafeToVendor(makeCafe({ active: false })).status).toBe("paused");
  });

  it("copies geo and arrays rather than referencing them", () => {
    const cafe = makeCafe();
    const vendor = cafeToVendor(cafe);
    expect(vendor.geo).not.toBe(cafe.geo);
    expect(vendor.capabilities).not.toBe(cafe.capabilities);
    expect(vendor.portalUserSubs).not.toBe(cafe.portalUserSubs);
  });
});

describe("vendorToCafe", () => {
  it("round-trips a migrated café back to its original document", () => {
    for (const active of [true, false]) {
      const cafe = makeCafe({ active });
      expect(vendorToCafe(cafeToVendor(cafe))).toEqual(cafe);
    }
  });

  it("collapses every non-active status to active: false", () => {
    const base = cafeToVendor(makeCafe());
    for (const status of ["pending", "paused", "suspended", "offline"] as const) {
      expect(vendorToCafe({ ...base, status }).active).toBe(false);
    }
    expect(vendorToCafe({ ...base, status: "active" }).active).toBe(true);
  });

  it("drops v2-only fields so the result matches the v1 schema", () => {
    const vendor: Vendor = { ...cafeToVendor(makeCafe()), ownerUserId: new ObjectId() };
    const cafe = vendorToCafe(vendor);
    expect("ownerUserId" in cafe).toBe(false);
    expect("status" in cafe).toBe(false);
    expect("businessName" in cafe).toBe(false);
  });
});
