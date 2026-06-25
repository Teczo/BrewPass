import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { newDocumentMeta } from "@/lib/models";
import type { DrinkSpec, MonthlyList, Vendor } from "@/lib/models";
import type { CoverageItem } from "@/lib/menu";
import type { RoutingCandidate } from "@/lib/order-engine/routing";
import {
  enumerateDeliveryDates,
  ordersFromList,
  planMonthlyEntries,
} from "@/lib/monthly-list/planner";

const now = new Date("2026-06-14T12:00:00Z");
const POINT = { lat: 3.139, lng: 101.6869 };

const DRINK: DrinkSpec = {
  drink: "Flat White",
  size: "regular",
  milk: "Oat",
  sugar: 0,
  strength: "regular",
};

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

describe("enumerateDeliveryDates", () => {
  it("returns only scheduled weekdays on/after fromDate within the month", () => {
    // June 2026: the 15th is a Monday. Weekdays Mon(1)/Wed(3).
    const dates = enumerateDeliveryDates("2026-06", "2026-06-15", [1, 3]);
    expect(dates[0]).toBe("2026-06-15"); // Mon
    expect(dates).toContain("2026-06-17"); // Wed
    expect(dates).toContain("2026-06-29"); // last Mon
    // Nothing before fromDate, nothing in another month.
    expect(dates.every((d) => d >= "2026-06-15" && d.startsWith("2026-06"))).toBe(true);
    // Only Mondays and Wednesdays.
    expect(dates).not.toContain("2026-06-16"); // Tue
  });

  it("excludes days before fromDate even if scheduled", () => {
    const dates = enumerateDeliveryDates("2026-06", "2026-06-20", [1, 2, 3, 4, 5, 6, 7]);
    expect(dates[0]).toBe("2026-06-20");
    expect(dates).not.toContain("2026-06-19");
  });

  it("handles month length correctly (30-day June)", () => {
    const dates = enumerateDeliveryDates("2026-06", "2026-06-01", [1, 2, 3, 4, 5, 6, 7]);
    expect(dates).toHaveLength(30);
    expect(dates.at(-1)).toBe("2026-06-30");
  });
});

describe("planMonthlyEntries", () => {
  const base = {
    period: "2026-06",
    fromDate: "2026-06-15",
    scheduleDays: [1, 3], // Mon, Wed
    time: "08:00",
    drink: DRINK,
    point: POINT,
    // Planning happens "now" (before any planned date), so the accept-cutoff
    // gate always passes.
    nowLocalDate: "2026-06-14",
    nowLocalTime: "12:00",
  };

  it("assigns the preferred vendor on every day when it is eligible", () => {
    const preferred = makeVendor();
    const other = makeVendor({ geo: { lat: 3.0, lng: 101.5 } });
    const entries = planMonthlyEntries({
      ...base,
      preferredVendorId: preferred._id,
      candidates: [makeCandidate(other), makeCandidate(preferred)],
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.vendorId?.equals(preferred._id))).toBe(true);
    expect(entries.every((e) => e.assignmentMethod === "user_preferred")).toBe(true);
    expect(entries.every((e) => !e.skipped)).toBe(true);
  });

  it("auto-routes to the nearest eligible vendor when no preference is set", () => {
    const near = makeVendor({ geo: { lat: 3.139, lng: 101.687 } });
    const far = makeVendor({ geo: { lat: 4.0, lng: 102.0 } });
    const entries = planMonthlyEntries({
      ...base,
      preferredVendorId: null,
      candidates: [makeCandidate(far), makeCandidate(near)],
    });
    expect(entries.every((e) => e.vendorId?.equals(near._id))).toBe(true);
    expect(entries.every((e) => e.assignmentMethod === "ai_routed")).toBe(true);
  });

  it("leaves the vendor null when no candidate can serve the day", () => {
    // Vendor closed on the scheduled weekdays → ineligible.
    const closed = makeVendor({ operatingHours: [{ day: 2, open: "08:00", close: "18:00" }] });
    const entries = planMonthlyEntries({
      ...base,
      preferredVendorId: null,
      candidates: [makeCandidate(closed)],
    });
    expect(entries.every((e) => e.vendorId === null)).toBe(true);
    expect(entries.every((e) => e.assignmentMethod === null)).toBe(true);
  });

  it("snapshots the injected price for assigned days only", () => {
    const vendor = makeVendor();
    const entries = planMonthlyEntries({
      ...base,
      preferredVendorId: null,
      candidates: [makeCandidate(vendor)],
      priceFor: () => 1200,
    });
    expect(entries.every((e) => e.priceSen === 1200)).toBe(true);
  });
});

describe("ordersFromList", () => {
  function makeList(entries: MonthlyList["entries"]): MonthlyList {
    return {
      _id: new ObjectId(),
      ...newDocumentMeta(),
      userId: new ObjectId(),
      subscriptionId: new ObjectId(),
      period: "2026-06",
      status: "proposed",
      generationMethod: "ai",
      time: "08:00",
      location: {
        locationId: new ObjectId(),
        label: "Home",
        address: "1 Jalan Test",
        geo: POINT,
      },
      entries,
      createdAt: now,
      updatedAt: now,
    };
  }

  const vendorId = new ObjectId();

  it("creates one scheduled order per assigned, non-skipped day", () => {
    const list = makeList([
      {
        date: "2026-06-15",
        weekday: 1,
        drink: DRINK,
        vendorId,
        assignmentMethod: "ai_routed",
        skipped: false,
        priceSen: 1200,
      },
      {
        date: "2026-06-17",
        weekday: 3,
        drink: DRINK,
        vendorId,
        assignmentMethod: "ai_routed",
        skipped: false,
      },
    ]);
    const orders = ordersFromList(list, now);
    expect(orders).toHaveLength(2);
    expect(orders[0].status).toBe("scheduled");
    expect(orders[0].monthlyListId?.equals(list._id)).toBe(true);
    expect(orders[0].vendorId.equals(vendorId)).toBe(true);
    expect(orders[0].priceSen).toBe(1200);
    expect(orders[1].priceSen).toBeUndefined();
    // Cutoff is 06:00 KL = 22:00 UTC the previous day.
    expect(orders[0].cutoffAt.toISOString()).toBe("2026-06-14T22:00:00.000Z");
    // Delivery 08:00 KL = 00:00 UTC same day.
    expect(orders[0].deliverAt.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("omits skipped days and days with no vendor", () => {
    const list = makeList([
      {
        date: "2026-06-15",
        weekday: 1,
        drink: DRINK,
        vendorId,
        assignmentMethod: "ai_routed",
        skipped: true,
      },
      {
        date: "2026-06-17",
        weekday: 3,
        drink: DRINK,
        vendorId: null,
        assignmentMethod: null,
        skipped: false,
      },
      {
        date: "2026-06-22",
        weekday: 1,
        drink: DRINK,
        vendorId,
        assignmentMethod: "user_preferred",
        skipped: false,
      },
    ]);
    const orders = ordersFromList(list, now);
    expect(orders).toHaveLength(1);
    expect(orders[0].date).toBe("2026-06-22");
    expect(orders[0].assignmentMethod).toBe("user_preferred");
  });

  it("snapshots the list location onto every order", () => {
    const list = makeList([
      {
        date: "2026-06-15",
        weekday: 1,
        drink: DRINK,
        vendorId,
        assignmentMethod: "ai_routed",
        skipped: false,
      },
    ]);
    const [order] = ordersFromList(list, now);
    expect(order.location.label).toBe("Home");
    expect(order.location.geo).toEqual(POINT);
    // Defensive copy — not the same reference as the list's snapshot.
    expect(order.location.geo).not.toBe(list.location.geo);
  });
});
