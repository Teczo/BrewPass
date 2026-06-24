import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import type { CoverageItem } from "@/lib/menu";
import { newDocumentMeta } from "@/lib/models";
import type { DrinkSpec, Vendor } from "@/lib/models";
import { type AiPlanInput, type DayChoice, assembleAiEntries } from "@/lib/monthly-list/ai-planner";
import type { RoutingCandidate } from "@/lib/order-engine/routing";

const now = new Date("2026-06-14T12:00:00Z");
const POINT = { lat: 3.139, lng: 101.6869 };

const ANCHOR: DrinkSpec = {
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

function makeCandidate(vendor: Vendor, menuItems: CoverageItem[] = []): RoutingCandidate {
  return { vendor, menuItems, assignedCount: 0, assignedByHour: {} };
}

// Mon (15th) and Wed (17th) of June 2026.
const baseInput = (over: Partial<AiPlanInput> = {}): AiPlanInput => ({
  period: "2026-06",
  fromDate: "2026-06-15",
  scheduleDays: [1, 3],
  time: "08:00",
  anchorDrink: ANCHOR,
  allowedDrinks: ["Flat White", "Latte", "Cold Brew"],
  point: POINT,
  preferredVendorId: null,
  candidates: [],
  priorities: { proximity: 2, price: 1, speed: 1, rating: 1, drink: 1 },
  nowLocalDate: "2026-06-14",
  nowLocalTime: "12:00",
  ...over,
});

const dates = ["2026-06-15", "2026-06-17"];

describe("assembleAiEntries", () => {
  it("honours a valid AI choice: varied drink, chosen vendor, kept rationale, menu price", () => {
    const vendor = makeVendor();
    const input = baseInput({
      candidates: [
        makeCandidate(vendor, [
          { category: "drink", taxonomySlug: "cold_brew", available: true, priceSen: 1200 },
        ]),
      ],
    });
    const choices = new Map<string, DayChoice>([
      [
        "2026-06-15",
        {
          date: "2026-06-15",
          drink: "Cold Brew",
          vendorId: vendor._id.toHexString(),
          rationale: "Hot day pick.",
        },
      ],
    ]);

    const entries = assembleAiEntries(input, dates, choices);
    const mon = entries.find((e) => e.date === "2026-06-15")!;
    expect(mon.drink.drink).toBe("Cold Brew");
    expect(mon.drink.milk).toBe("Oat"); // inherited from the anchor
    expect(mon.vendorId?.equals(vendor._id)).toBe(true);
    expect(mon.assignmentMethod).toBe("ai_routed");
    expect(mon.priceSen).toBe(1200);
    expect(mon.rationale).toBe("Hot day pick.");
  });

  it("falls back to the anchor drink when the AI picks a non-taxonomy coffee", () => {
    const vendor = makeVendor();
    const input = baseInput({ candidates: [makeCandidate(vendor)] });
    const choices = new Map<string, DayChoice>([
      [
        "2026-06-15",
        {
          date: "2026-06-15",
          drink: "Unicorn Frappe",
          vendorId: vendor._id.toHexString(),
          rationale: "x",
        },
      ],
    ]);

    const entries = assembleAiEntries(input, dates, choices);
    expect(entries.find((e) => e.date === "2026-06-15")!.drink.drink).toBe("Flat White");
  });

  it("ignores an unknown vendor id and routes normally, dropping the rationale", () => {
    const real = makeVendor({ geo: { lat: 3.139, lng: 101.687 } });
    const input = baseInput({ candidates: [makeCandidate(real)] });
    const choices = new Map<string, DayChoice>([
      [
        "2026-06-15",
        {
          date: "2026-06-15",
          drink: "Latte",
          vendorId: new ObjectId().toHexString(),
          rationale: "ghost vendor",
        },
      ],
    ]);

    const mon = assembleAiEntries(input, dates, choices).find((e) => e.date === "2026-06-15")!;
    expect(mon.drink.drink).toBe("Latte"); // valid drink still honoured
    expect(mon.vendorId?.equals(real._id)).toBe(true); // routed to the real candidate
    expect(mon.rationale).toBeUndefined(); // AI's vendor not honoured → no rationale
  });

  it("with no choices, reproduces the deterministic usual-every-day plan", () => {
    const preferred = makeVendor();
    const other = makeVendor({ geo: { lat: 3.0, lng: 101.5 } });
    const input = baseInput({
      preferredVendorId: preferred._id,
      candidates: [makeCandidate(other), makeCandidate(preferred)],
    });

    const entries = assembleAiEntries(input, dates, new Map());
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.drink.drink === "Flat White")).toBe(true);
    expect(entries.every((e) => e.vendorId?.equals(preferred._id))).toBe(true);
    expect(entries.every((e) => e.rationale === undefined)).toBe(true);
  });

  it("leaves the vendor null (no rationale) when no candidate can serve the day", () => {
    const closed = makeVendor({ operatingHours: [{ day: 2, open: "08:00", close: "18:00" }] });
    const input = baseInput({ candidates: [makeCandidate(closed)] });
    const choices = new Map<string, DayChoice>([
      [
        "2026-06-15",
        { date: "2026-06-15", drink: "Latte", vendorId: closed._id.toHexString(), rationale: "y" },
      ],
    ]);

    const mon = assembleAiEntries(input, dates, choices).find((e) => e.date === "2026-06-15")!;
    expect(mon.vendorId).toBeNull();
    expect(mon.assignmentMethod).toBeNull();
    expect(mon.rationale).toBeUndefined();
  });
});
