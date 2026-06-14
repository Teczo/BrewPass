import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import type { Vendor } from "@/lib/models";
import type { CoverageItem } from "@/lib/menu";
import {
  isEligible,
  isVendorOpenAt,
  isWithinServiceArea,
  rankCandidates,
  selectVendor,
  type RoutingCandidate,
  type RoutingRequest,
} from "@/lib/order-engine/routing";

const now = new Date("2026-06-09T12:00:00Z");
// Subscriber location (KL city centre).
const POINT = { lat: 3.139, lng: 101.6869 };

function makeVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    _id: new ObjectId(),
    businessName: "Kopi Corner",
    status: "active",
    address: "Jalan Sultan Ismail",
    geo: { lat: 3.14, lng: 101.69 },
    capabilities: [],
    capacityPerHour: 30,
    portalUserSubs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCandidate(
  vendor: Vendor,
  extras: { menuItems?: CoverageItem[]; assignedCount?: number } = {},
): RoutingCandidate {
  return { vendor, menuItems: extras.menuItems ?? [], assignedCount: extras.assignedCount ?? 0 };
}

const baseRequest: RoutingRequest = {
  preferredVendorId: null,
  point: POINT,
  weekday: 3,
  time: "08:00",
  drink: { drink: "Flat White", milk: "Oat" },
};

describe("isVendorOpenAt", () => {
  const hours = [{ day: 3, open: "08:00", close: "18:00" }];

  it("treats unset hours as always open", () => {
    expect(isVendorOpenAt(undefined, 3, "23:30")).toBe(true);
  });

  it("is open within the window (open inclusive, close exclusive)", () => {
    expect(isVendorOpenAt(hours, 3, "08:00")).toBe(true);
    expect(isVendorOpenAt(hours, 3, "12:00")).toBe(true);
    expect(isVendorOpenAt(hours, 3, "18:00")).toBe(false);
    expect(isVendorOpenAt(hours, 3, "07:59")).toBe(false);
  });

  it("is closed on a day with no window", () => {
    expect(isVendorOpenAt(hours, 4, "12:00")).toBe(false);
  });
});

describe("isWithinServiceArea", () => {
  it("treats unset radius as unbounded", () => {
    const faraway = makeVendor({ geo: { lat: 5.41, lng: 100.33 } }); // Penang
    expect(isWithinServiceArea(faraway, POINT)).toBe(true);
  });

  it("includes points inside the radius and excludes points outside it", () => {
    const near = makeVendor({ geo: { lat: 3.14, lng: 101.69 }, serviceAreaRadiusKm: 5 });
    const far = makeVendor({ geo: { lat: 3.5, lng: 102.0 }, serviceAreaRadiusKm: 5 });
    expect(isWithinServiceArea(near, POINT)).toBe(true);
    expect(isWithinServiceArea(far, POINT)).toBe(false);
  });
});

describe("isEligible", () => {
  it("passes an active, in-area, open, under-capacity vendor that covers the drink", () => {
    expect(isEligible(makeCandidate(makeVendor()), baseRequest)).toBe(true);
  });

  it.each(["pending", "paused", "suspended", "offline"] as const)(
    "rejects %s vendors",
    (status) => {
      expect(isEligible(makeCandidate(makeVendor({ status })), baseRequest)).toBe(false);
    },
  );

  it("rejects vendors out of the service area", () => {
    const vendor = makeVendor({ geo: { lat: 3.5, lng: 102.0 }, serviceAreaRadiusKm: 5 });
    expect(isEligible(makeCandidate(vendor), baseRequest)).toBe(false);
  });

  it("rejects vendors closed at the delivery time", () => {
    const vendor = makeVendor({ operatingHours: [{ day: 3, open: "10:00", close: "18:00" }] });
    expect(isEligible(makeCandidate(vendor), baseRequest)).toBe(false); // 08:00 is before open
  });

  it("rejects vendors at daily capacity", () => {
    const vendor = makeVendor({ dailyCapacity: 2 });
    expect(isEligible(makeCandidate(vendor, { assignedCount: 2 }), baseRequest)).toBe(false);
    expect(isEligible(makeCandidate(vendor, { assignedCount: 1 }), baseRequest)).toBe(true);
  });

  it("rejects vendors whose published menu can't make the drink", () => {
    const menuItems: CoverageItem[] = [
      { category: "drink", taxonomySlug: "latte", available: true },
    ];
    expect(isEligible(makeCandidate(makeVendor(), { menuItems }), baseRequest)).toBe(false);
  });
});

describe("rankCandidates", () => {
  it("orders nearest-first, rating breaks ties", () => {
    const near = makeCandidate(makeVendor({ geo: { lat: 3.14, lng: 101.69 } }));
    const far = makeCandidate(makeVendor({ geo: { lat: 3.2, lng: 101.75 } }));
    expect(rankCandidates([far, near], POINT)[0]).toBe(near);

    // Same location → higher rating wins.
    const lowRated = makeCandidate(makeVendor({ geo: POINT, ratingScore: 3.0 }));
    const highRated = makeCandidate(makeVendor({ geo: POINT, ratingScore: 4.8 }));
    expect(rankCandidates([lowRated, highRated], POINT)[0]).toBe(highRated);
  });
});

describe("selectVendor", () => {
  it("uses the confirmed preferred vendor when it's eligible", () => {
    const preferred = makeVendor({ geo: { lat: 3.3, lng: 101.8 } }); // farther than the other
    const other = makeVendor({ geo: { lat: 3.14, lng: 101.69 } });
    const result = selectVendor({ ...baseRequest, preferredVendorId: preferred._id }, [
      makeCandidate(other),
      makeCandidate(preferred),
    ]);
    expect(result).toEqual({ ok: true, vendorId: preferred._id, method: "user_preferred" });
  });

  it("auto-routes to the nearest when the preferred vendor is ineligible", () => {
    const preferred = makeVendor({ status: "paused", geo: { lat: 3.14, lng: 101.69 } });
    const near = makeVendor({ geo: { lat: 3.15, lng: 101.7 } });
    const far = makeVendor({ geo: { lat: 3.3, lng: 101.85 } });
    const result = selectVendor({ ...baseRequest, preferredVendorId: preferred._id }, [
      makeCandidate(preferred),
      makeCandidate(far),
      makeCandidate(near),
    ]);
    expect(result).toEqual({ ok: true, vendorId: near._id, method: "ai_routed" });
  });

  it("auto-routes nearest-first with no preferred vendor", () => {
    const near = makeVendor({ geo: { lat: 3.14, lng: 101.69 } });
    const far = makeVendor({ geo: { lat: 3.4, lng: 101.9 } });
    const result = selectVendor(baseRequest, [makeCandidate(far), makeCandidate(near)]);
    expect(result).toMatchObject({ ok: true, vendorId: near._id, method: "ai_routed" });
  });

  it("excludes declined vendors (reassignment path)", () => {
    const declined = makeVendor({ geo: { lat: 3.14, lng: 101.69 } }); // nearest
    const alternative = makeVendor({ geo: { lat: 3.2, lng: 101.75 } });
    const result = selectVendor({ ...baseRequest, excludeVendorIds: [declined._id] }, [
      makeCandidate(declined),
      makeCandidate(alternative),
    ]);
    expect(result).toEqual({ ok: true, vendorId: alternative._id, method: "ai_routed" });
  });

  it("reports no_vendor_available when nothing is eligible", () => {
    const closed = makeVendor({ status: "offline" });
    expect(selectVendor(baseRequest, [makeCandidate(closed)])).toEqual({
      ok: false,
      reason: "no_vendor_available",
    });
    expect(selectVendor(baseRequest, [])).toEqual({ ok: false, reason: "no_vendor_available" });
  });
});
