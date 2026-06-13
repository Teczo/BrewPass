import { describe, expect, it } from "vitest";

import {
  emptyValueSets,
  findUncoveredDrinkField,
  slugify,
  TAXONOMY_SEED,
  valueSetsFrom,
} from "@/lib/taxonomy";

describe("slugify", () => {
  it("lowercases and underscores non-alphanumerics", () => {
    expect(slugify("Flat White")).toBe("flat_white");
    expect(slugify("Lactose-free")).toBe("lactose_free");
    expect(slugify("Flat White Decaf")).toBe("flat_white_decaf");
    expect(slugify("  Oat  ")).toBe("oat");
    expect(slugify("None")).toBe("none");
  });
});

describe("TAXONOMY_SEED", () => {
  it("covers the v1 enums so existing size/strength values stay valid", () => {
    const values = (category: string) =>
      TAXONOMY_SEED.filter((o) => o.category === category).map((o) => o.value);
    expect(values("size")).toEqual(["small", "regular", "large"]);
    expect(values("strength")).toEqual(["mild", "regular", "strong", "double"]);
    expect(values("drink")).toContain("Flat White");
    expect(values("milk")).toContain("Oat");
  });

  it("includes the broader café-standard additions", () => {
    const drinks = TAXONOMY_SEED.filter((o) => o.category === "drink").map((o) => o.value);
    expect(drinks).toEqual(expect.arrayContaining(["Piccolo", "Cortado", "Flat White Decaf"]));
  });

  it("produces unique (category, slug) pairs", () => {
    const keys = TAXONOMY_SEED.map((o) => `${o.category}:${slugify(o.value)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("findUncoveredDrinkField", () => {
  const sets = valueSetsFrom([
    { category: "drink", value: "Flat White", active: true },
    { category: "drink", value: "Latte", active: true },
    { category: "size", value: "regular", active: true },
    { category: "milk", value: "Oat", active: true },
    { category: "milk", value: "None", active: true },
    { category: "strength", value: "strong", active: true },
    // An inactive drink must not count as covered.
    { category: "drink", value: "Retired", active: false },
  ]);

  const okDrink = { drink: "Flat White", size: "regular", milk: "Oat", strength: "strong" };

  it("returns null when every field is an active taxonomy member", () => {
    expect(findUncoveredDrinkField(sets, okDrink)).toBeNull();
  });

  it("flags the offending field and value", () => {
    expect(findUncoveredDrinkField(sets, { ...okDrink, drink: "Mocha" })).toEqual({
      field: "drink",
      value: "Mocha",
    });
    expect(findUncoveredDrinkField(sets, { ...okDrink, drink: "Retired" })).toEqual({
      field: "drink",
      value: "Retired",
    });
  });

  it("fails open for a category with no seeded options (deploy ordering)", () => {
    const partial = valueSetsFrom([{ category: "drink", value: "Flat White", active: true }]);
    // size/milk/strength sets are empty → skipped, drink still enforced.
    expect(findUncoveredDrinkField(partial, okDrink)).toBeNull();
    expect(findUncoveredDrinkField(partial, { ...okDrink, drink: "Nope" })).toEqual({
      field: "drink",
      value: "Nope",
    });
  });

  it("enforces nothing when the taxonomy is entirely empty", () => {
    expect(findUncoveredDrinkField(emptyValueSets(), okDrink)).toBeNull();
  });
});
