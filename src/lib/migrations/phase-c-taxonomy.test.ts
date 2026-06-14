import { describe, expect, it } from "vitest";

import type { DrinkSpec } from "@/lib/models";
import { distinctDrinkOptions, toTaxonomyFields } from "@/lib/migrations/phase-c-taxonomy";

function makeDrink(overrides: Partial<DrinkSpec> = {}): DrinkSpec {
  return {
    drink: "Flat White",
    size: "regular",
    milk: "Oat",
    sugar: 1,
    strength: "strong",
    ...overrides,
  };
}

describe("toTaxonomyFields", () => {
  it("derives slug from value and carries the sort order", () => {
    expect(
      toTaxonomyFields({ category: "drink", value: "Flat White", label: "Flat White" }, 3),
    ).toEqual({
      category: "drink",
      slug: "flat_white",
      value: "Flat White",
      label: "Flat White",
      sortOrder: 3,
    });
  });
});

describe("distinctDrinkOptions", () => {
  it("extracts the four taxonomy-backed fields from each drink spec", () => {
    const options = distinctDrinkOptions([makeDrink()]);
    expect(options).toEqual(
      expect.arrayContaining([
        { category: "drink", value: "Flat White", label: "Flat White" },
        { category: "size", value: "regular", label: "regular" },
        { category: "milk", value: "Oat", label: "Oat" },
        { category: "strength", value: "strong", label: "strong" },
      ]),
    );
    // sugar is a quantity, never a taxonomy option.
    expect(options.some((o) => o.value === "1")).toBe(false);
  });

  it("dedupes by (category, slug) across many specs", () => {
    const options = distinctDrinkOptions([
      makeDrink({ drink: "Flat White" }),
      makeDrink({ drink: "Flat White" }),
      makeDrink({ drink: "Kopi O Kosong" }), // a legacy custom value
    ]);
    const drinks = options.filter((o) => o.category === "drink").map((o) => o.value);
    expect(drinks).toEqual(["Flat White", "Kopi O Kosong"]);
  });

  it("surfaces legacy values so the migration can absorb them", () => {
    const options = distinctDrinkOptions([makeDrink({ milk: "Goat milk" })]);
    expect(options).toContainEqual({ category: "milk", value: "Goat milk", label: "Goat milk" });
  });
});
