import type { DrinkSpec } from "@/lib/models";

/**
 * Opt-in health insights (Phase 10) — rough, clearly-labelled estimates
 * derived from confirmed orders. Pure and unit-tested. Not medical
 * advice; surfaced with an "estimates" disclaimer in the UI.
 */

/** Approximate caffeine (mg) for a regular-strength drink, by name keyword. */
const CAFFEINE_BASE: Array<{ pattern: RegExp; mg: number }> = [
  { pattern: /cold brew/i, mg: 200 },
  { pattern: /espresso/i, mg: 75 },
  { pattern: /americano|long black/i, mg: 130 },
  { pattern: /matcha/i, mg: 70 },
  { pattern: /tea/i, mg: 50 },
  { pattern: /mocha|latte|flat white|cappuccino|magic|piccolo/i, mg: 130 },
];
const CAFFEINE_DEFAULT_MG = 100;

const STRENGTH_MULTIPLIER: Record<DrinkSpec["strength"], number> = {
  mild: 0.75,
  regular: 1,
  strong: 1.5,
  double: 2,
};

/** ~4g sugar per "sugar level" step; chocolatey/sweetened drinks add a base. */
const SUGAR_PER_LEVEL_G = 4;
const SWEET_DRINK_BONUS: Array<{ pattern: RegExp; grams: number }> = [
  { pattern: /mocha|spanish latte/i, grams: 12 },
];

export function estimateCaffeineMg(drink: Pick<DrinkSpec, "drink" | "strength">): number {
  const base =
    CAFFEINE_BASE.find((entry) => entry.pattern.test(drink.drink))?.mg ?? CAFFEINE_DEFAULT_MG;
  return Math.round(base * STRENGTH_MULTIPLIER[drink.strength]);
}

export function estimateSugarG(drink: Pick<DrinkSpec, "drink" | "sugar">): number {
  const bonus = SWEET_DRINK_BONUS.find((entry) => entry.pattern.test(drink.drink))?.grams ?? 0;
  return drink.sugar * SUGAR_PER_LEVEL_G + bonus;
}

export interface HealthSummary {
  cups: number;
  caffeineMg: number;
  sugarG: number;
  avgCaffeineMgPerDay: number;
}

/** Aggregate estimates over a window of consumed drinks. */
export function summarizeHealth(
  drinks: Array<Pick<DrinkSpec, "drink" | "strength" | "sugar">>,
  windowDays: number,
): HealthSummary {
  let caffeineMg = 0;
  let sugarG = 0;
  for (const drink of drinks) {
    caffeineMg += estimateCaffeineMg(drink);
    sugarG += estimateSugarG(drink);
  }
  return {
    cups: drinks.length,
    caffeineMg,
    sugarG,
    avgCaffeineMgPerDay: windowDays > 0 ? Math.round(caffeineMg / windowDays) : 0,
  };
}
