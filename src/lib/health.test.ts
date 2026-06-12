import { describe, expect, it } from "vitest";

import { estimateCaffeineMg, estimateSugarG, summarizeHealth } from "@/lib/health";

describe("estimateCaffeineMg", () => {
  it("scales the base estimate by strength", () => {
    expect(estimateCaffeineMg({ drink: "Flat White", strength: "regular" })).toBe(130);
    expect(estimateCaffeineMg({ drink: "Flat White", strength: "double" })).toBe(260);
    expect(estimateCaffeineMg({ drink: "Flat White", strength: "mild" })).toBe(98);
  });

  it("recognises drink families and falls back for unknowns", () => {
    expect(estimateCaffeineMg({ drink: "Cold Brew", strength: "regular" })).toBe(200);
    expect(estimateCaffeineMg({ drink: "Double Espresso", strength: "regular" })).toBe(75);
    expect(estimateCaffeineMg({ drink: "Iced Matcha Latte", strength: "regular" })).toBe(70);
    expect(estimateCaffeineMg({ drink: "Mystery Brew", strength: "regular" })).toBe(100);
  });
});

describe("estimateSugarG", () => {
  it("counts sugar levels and sweet-drink bonuses", () => {
    expect(estimateSugarG({ drink: "Americano", sugar: 0 })).toBe(0);
    expect(estimateSugarG({ drink: "Americano", sugar: 2 })).toBe(8);
    expect(estimateSugarG({ drink: "Mocha", sugar: 0 })).toBe(12);
    expect(estimateSugarG({ drink: "Spanish Latte", sugar: 1 })).toBe(16);
  });
});

describe("summarizeHealth", () => {
  it("aggregates a week of drinks", () => {
    const drinks = [
      { drink: "Flat White", strength: "regular" as const, sugar: 1 },
      { drink: "Mocha", strength: "strong" as const, sugar: 2 },
    ];
    const summary = summarizeHealth(drinks, 7);
    expect(summary.cups).toBe(2);
    expect(summary.caffeineMg).toBe(130 + 195);
    expect(summary.sugarG).toBe(4 + 20);
    expect(summary.avgCaffeineMgPerDay).toBe(Math.round(325 / 7));
  });

  it("handles an empty window", () => {
    expect(summarizeHealth([], 7)).toEqual({
      cups: 0,
      caffeineMg: 0,
      sugarG: 0,
      avgCaffeineMgPerDay: 0,
    });
  });
});
