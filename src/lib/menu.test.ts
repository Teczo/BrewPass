import { describe, expect, it } from "vitest";

import { vendorCoversDrink, type CoverageItem } from "@/lib/menu";

const drinkItem = (slug: string, available = true): CoverageItem => ({
  category: "drink",
  taxonomySlug: slug,
  available,
});
const milkItem = (slug: string, available = true): CoverageItem => ({
  category: "milk",
  taxonomySlug: slug,
  available,
});

describe("vendorCoversDrink", () => {
  it("covers everything when the vendor has published no menu (v1 back-compat)", () => {
    expect(vendorCoversDrink([], "Flat White", "Oat")).toBe(true);
  });

  it("requires the drink to be published and available", () => {
    const menu = [drinkItem("flat_white"), drinkItem("latte", false)];
    expect(vendorCoversDrink(menu, "Flat White", null)).toBe(true);
    expect(vendorCoversDrink(menu, "Latte", null)).toBe(false); // off menu
    expect(vendorCoversDrink(menu, "Mocha", null)).toBe(false); // not on menu
  });

  it("ignores milk when the vendor hasn't curated milks", () => {
    expect(vendorCoversDrink([drinkItem("flat_white")], "Flat White", "Oat")).toBe(true);
  });

  it("enforces milk availability once the vendor curates milks", () => {
    const menu = [drinkItem("flat_white"), milkItem("oat"), milkItem("soy", false)];
    expect(vendorCoversDrink(menu, "Flat White", "Oat")).toBe(true);
    expect(vendorCoversDrink(menu, "Flat White", "Soy")).toBe(false); // milk off menu
    expect(vendorCoversDrink(menu, "Flat White", "Almond")).toBe(false); // milk not offered
  });

  it("treats a None milk choice as always covered", () => {
    const menu = [drinkItem("flat_white"), milkItem("oat")];
    expect(vendorCoversDrink(menu, "Flat White", "None")).toBe(true);
  });
});
