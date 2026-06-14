import { describe, expect, it } from "vitest";

import { deterministicRecommend, type Priorities } from "@/lib/vendor-recommender";
import type { VendorCard } from "@/lib/vendor-selection";

function card(overrides: Partial<VendorCard> & { id: string }): VendorCard {
  return {
    name: `Vendor ${overrides.id}`,
    address: "somewhere",
    distanceKm: 5,
    ratingScore: null,
    coversDrink: true,
    priceSen: null,
    ...overrides,
  };
}

const priorities = (overrides: Partial<Priorities> = {}): Priorities => ({
  proximity: 0,
  price: 0,
  speed: 0,
  rating: 0,
  drink: 0,
  ...overrides,
});

describe("deterministicRecommend", () => {
  it("picks the nearest when proximity dominates", () => {
    const cards = [
      card({ id: "far", distanceKm: 8, ratingScore: 5 }),
      card({ id: "near", distanceKm: 1, ratingScore: 3 }),
    ];
    expect(deterministicRecommend(cards, priorities({ proximity: 3 })).vendorId).toBe("near");
  });

  it("picks the highest rated when rating dominates", () => {
    const cards = [
      card({ id: "near", distanceKm: 1, ratingScore: 3.0 }),
      card({ id: "loved", distanceKm: 6, ratingScore: 4.9 }),
    ];
    expect(deterministicRecommend(cards, priorities({ rating: 3 })).vendorId).toBe("loved");
  });

  it("picks the cheapest when price dominates", () => {
    const cards = [
      card({ id: "pricey", distanceKm: 1, priceSen: 1500 }),
      card({ id: "cheap", distanceKm: 5, priceSen: 800 }),
    ];
    expect(deterministicRecommend(cards, priorities({ price: 3 })).vendorId).toBe("cheap");
  });

  it("treats speed like proximity and drink-quality like rating", () => {
    const cards = [
      card({ id: "near", distanceKm: 1, ratingScore: 3 }),
      card({ id: "far", distanceKm: 9, ratingScore: 3 }),
    ];
    expect(deterministicRecommend(cards, priorities({ speed: 3 })).vendorId).toBe("near");

    const rated = [
      card({ id: "ok", distanceKm: 1, ratingScore: 3.2 }),
      card({ id: "great", distanceKm: 1, ratingScore: 4.7 }),
    ];
    expect(deterministicRecommend(rated, priorities({ drink: 3 })).vendorId).toBe("great");
  });

  it("falls back to nearest when no priority is set", () => {
    const cards = [
      card({ id: "far", distanceKm: 7, ratingScore: 5, priceSen: 500 }),
      card({ id: "near", distanceKm: 2 }),
    ];
    expect(deterministicRecommend(cards, priorities()).vendorId).toBe("near");
  });

  it("returns a human-readable rationale for the winner", () => {
    const cards = [
      card({ id: "a", name: "Brew Lab", distanceKm: 1.5, ratingScore: 4.6, priceSen: 1200 }),
    ];
    const result = deterministicRecommend(cards, priorities({ proximity: 2 }));
    expect(result.vendorId).toBe("a");
    expect(result.rationale).toContain("Brew Lab");
    expect(result.rationale).toContain("1.5 km");
  });
});
