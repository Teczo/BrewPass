import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { newDocumentMeta } from "@/lib/models";
import type { Vendor } from "@/lib/models";
import type { CoverageItem } from "@/lib/menu";
import {
  hasAreaCoverage,
  isEligible,
  isNotSoldOut,
  isUnderSlotCap,
  isVendorAcceptingAssignment,
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
    ...newDocumentMeta(),
    businessName: "Kopi Corner",
    status: "active",
    market: "MY",
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
  extras: {
    menuItems?: CoverageItem[];
    assignedCount?: number;
    assignedByHour?: Record<number, number>;
  } = {},
): RoutingCandidate {
  return {
    vendor,
    menuItems: extras.menuItems ?? [],
    assignedCount: extras.assignedCount ?? 0,
    assignedByHour: extras.assignedByHour ?? {},
  };
}

const baseRequest: RoutingRequest = {
  preferredVendorId: null,
  point: POINT,
  date: "2026-06-10",
  weekday: 3,
  time: "08:00",
  drink: { drink: "Flat White", milk: "Oat" },
  // Night-before assignment by default (the day before delivery).
  nowLocalDate: "2026-06-09",
  nowLocalTime: "20:00",
};

describe("hasAreaCoverage (Phase O.1 cold-start gap test)", () => {
  it("is false when no candidate's service area covers the point (coverage gap)", () => {
    const far = makeVendor({ geo: { lat: 3.5, lng: 102.0 }, serviceAreaRadiusKm: 5 });
    expect(hasAreaCoverage([makeCandidate(far)], POINT)).toBe(false);
    // No vendors at all (true cold start) is also a coverage gap.
    expect(hasAreaCoverage([], POINT)).toBe(false);
  });

  it("is true when a candidate covers the point, even if it's transiently unavailable", () => {
    // Sold out + at capacity + closed today, but its area still covers the
    // point — that's a transient miss (O.2), not a coverage gap, so no waitlist.
    const covering = makeVendor({
      geo: { lat: 3.14, lng: 101.69 },
      serviceAreaRadiusKm: 5,
      status: "offline",
      soldOutDates: [baseRequest.date],
    });
    expect(hasAreaCoverage([makeCandidate(covering, { assignedCount: 999 })], POINT)).toBe(true);
  });

  it("treats an unbounded (unset radius) vendor as covering everywhere", () => {
    const unbounded = makeVendor({ geo: { lat: 5.41, lng: 100.33 } }); // Penang, no radius
    expect(hasAreaCoverage([makeCandidate(unbounded)], POINT)).toBe(true);
  });
});

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

  it("rejects vendors whose delivery-hour slot cap is full (Phase F)", () => {
    // 08:00 delivery → hour 8. Cap 1 for that hour.
    const vendor = makeVendor({ slotCapacities: [{ hour: 8, cap: 1 }] });
    expect(isEligible(makeCandidate(vendor, { assignedByHour: { 8: 1 } }), baseRequest)).toBe(
      false,
    );
    expect(isEligible(makeCandidate(vendor, { assignedByHour: { 8: 0 } }), baseRequest)).toBe(true);
    // A full hour 9 doesn't block an 08:00 delivery.
    expect(isEligible(makeCandidate(vendor, { assignedByHour: { 9: 5 } }), baseRequest)).toBe(true);
  });

  it("rejects vendors marked sold out for the delivery date (Phase F)", () => {
    const vendor = makeVendor({ soldOutDates: ["2026-06-10"] });
    expect(isEligible(makeCandidate(vendor), baseRequest)).toBe(false);
    expect(isEligible(makeCandidate(vendor), { ...baseRequest, date: "2026-06-11" })).toBe(true);
  });

  it("rejects quality-suspended vendors (Phase G)", () => {
    const vendor = makeVendor({ qualitySuspendedAt: now, qualityFlagReason: "low_rating" });
    expect(isEligible(makeCandidate(vendor), baseRequest)).toBe(false);
  });
});

describe("rankCandidates quality tiebreak", () => {
  it("breaks an equal-distance tie by composite quality (Phase G)", () => {
    // Same location; A has worse acceptance/on-time despite equal rating.
    const better = makeCandidate(
      makeVendor({ geo: POINT, ratingScore: 4, acceptanceRate: 1, onTimeRate: 1 }),
    );
    const worse = makeCandidate(
      makeVendor({ geo: POINT, ratingScore: 4, acceptanceRate: 0.5, onTimeRate: 0.5 }),
    );
    expect(rankCandidates([worse, better], POINT)[0]).toBe(better);
  });
});

describe("isUnderSlotCap", () => {
  it("treats hours with no configured cap as unbounded", () => {
    const vendor = makeVendor({ slotCapacities: [{ hour: 9, cap: 1 }] });
    expect(isUnderSlotCap(makeCandidate(vendor, { assignedByHour: { 8: 99 } }), baseRequest)).toBe(
      true,
    );
  });

  it("closes an hour with a cap of 0", () => {
    const vendor = makeVendor({ slotCapacities: [{ hour: 8, cap: 0 }] });
    expect(isUnderSlotCap(makeCandidate(vendor), baseRequest)).toBe(false);
  });
});

describe("isNotSoldOut", () => {
  it("is true unless the date is in soldOutDates", () => {
    expect(isNotSoldOut(makeVendor(), "2026-06-10")).toBe(true);
    expect(isNotSoldOut(makeVendor({ soldOutDates: ["2026-06-10"] }), "2026-06-10")).toBe(false);
  });
});

describe("isVendorAcceptingAssignment", () => {
  const vendor = makeVendor({ orderAcceptCutoff: "04:00" });

  it("accepts when assigned before the delivery day (night-before generation)", () => {
    expect(isVendorAcceptingAssignment(vendor, baseRequest)).toBe(true);
  });

  it("on the delivery day, gates on the cutoff time", () => {
    const sameDay = { ...baseRequest, nowLocalDate: "2026-06-10" };
    expect(isVendorAcceptingAssignment(vendor, { ...sameDay, nowLocalTime: "03:59" })).toBe(true);
    expect(isVendorAcceptingAssignment(vendor, { ...sameDay, nowLocalTime: "04:00" })).toBe(false);
  });

  it("never accepts once the delivery day has passed", () => {
    expect(
      isVendorAcceptingAssignment(vendor, { ...baseRequest, nowLocalDate: "2026-06-11" }),
    ).toBe(false);
  });

  it("has no effect when the vendor sets no cutoff", () => {
    const sameDayLate = { ...baseRequest, nowLocalDate: "2026-06-10", nowLocalTime: "23:00" };
    expect(isVendorAcceptingAssignment(makeVendor(), sameDayLate)).toBe(true);
  });

  it("bypassAcceptCutoff overrides the gate (Phase O.2 §2.5 emergency reassignment)", () => {
    // Same delivery day, well past the 04:00 cutoff — normally rejected.
    const pastCutoff = { ...baseRequest, nowLocalDate: "2026-06-10", nowLocalTime: "09:00" };
    expect(isVendorAcceptingAssignment(vendor, pastCutoff)).toBe(false);
    expect(isVendorAcceptingAssignment(vendor, { ...pastCutoff, bypassAcceptCutoff: true })).toBe(
      true,
    );
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
