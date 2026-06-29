import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { newDocumentMeta } from "@/lib/models";
import type { LaunchWaitlist, Vendor } from "@/lib/models";
import { vendorCoversWaitlistEntry } from "@/lib/launch-waitlist";

const POINT = { lat: 3.139, lng: 101.6869 }; // KL city centre

function makeVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    businessName: "Kopi Corner",
    status: "active",
    market: "MY",
    address: "Jalan Sultan Ismail",
    geo: { lat: 3.14, lng: 101.69 },
    serviceAreaRadiusKm: 5,
    capabilities: [],
    capacityPerHour: 30,
    portalUserSubs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<LaunchWaitlist> = {}): LaunchWaitlist {
  return {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    userId: new ObjectId(),
    address: "Jalan Sultan Ismail",
    geo: POINT,
    market: "MY",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("vendorCoversWaitlistEntry", () => {
  it("matches an active, same-market vendor whose area covers the entry", () => {
    expect(vendorCoversWaitlistEntry(makeVendor(), makeEntry())).toBe(true);
  });

  it("does not match a vendor in a different market", () => {
    const auVendor = makeVendor({ market: "AU", geo: { lat: -31.95, lng: 115.86 } });
    expect(vendorCoversWaitlistEntry(auVendor, makeEntry({ market: "MY" }))).toBe(false);
  });

  it("does not match a non-active vendor", () => {
    for (const status of ["pending", "paused", "suspended", "offline", "rejected"] as const) {
      expect(vendorCoversWaitlistEntry(makeVendor({ status }), makeEntry())).toBe(false);
    }
  });

  it("does not match when the entry is outside the vendor's service radius", () => {
    const far = makeEntry({ geo: { lat: 3.5, lng: 102.0 } });
    expect(vendorCoversWaitlistEntry(makeVendor(), far)).toBe(false);
  });

  it("matches an unbounded (unset radius) vendor anywhere in-market", () => {
    const unbounded = makeVendor({
      serviceAreaRadiusKm: undefined,
      geo: { lat: 5.41, lng: 100.33 },
    });
    expect(vendorCoversWaitlistEntry(unbounded, makeEntry())).toBe(true);
  });
});
