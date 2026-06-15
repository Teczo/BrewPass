import type { OptionCategory } from "@/lib/models";
import { slugify } from "@/lib/taxonomy";

/**
 * Menu-coverage logic — pure and tested here, wired into routing in Phase D
 * ("can this vendor make the drink?"). Lives with the menu/taxonomy work so
 * the rule is settled alongside the data model it depends on.
 */

export interface CoverageItem {
  category: OptionCategory;
  taxonomySlug: string;
  available: boolean;
  /** Vendor's price for this item in sen, when published. */
  priceSen?: number;
}

/** The vendor's published price (sen) for a drink, or null when unpriced. */
export function vendorDrinkPriceSen(items: CoverageItem[], drinkValue: string): number | null {
  const drinkSlug = slugify(drinkValue);
  const match = items.find((item) => item.category === "drink" && item.taxonomySlug === drinkSlug);
  return match?.priceSen ?? null;
}

/**
 * Whether a vendor can fulfil a subscriber's drink + milk choice.
 *
 * - A vendor with no menu items at all offers the full canonical menu
 *   (v1 back-compat for migrated/un-curated vendors).
 * - Otherwise the drink must be published and available.
 * - Milk is covered when the vendor hasn't curated milks at all, when the
 *   choice is "None", or when the matching milk is published and available.
 * - Size and strength are universal in this phase and never block coverage.
 */
export function vendorCoversDrink(
  items: CoverageItem[],
  drinkValue: string,
  milkValue: string | null,
): boolean {
  if (items.length === 0) return true;

  const drinkSlug = slugify(drinkValue);
  const drinkOk = items.some(
    (item) => item.category === "drink" && item.taxonomySlug === drinkSlug && item.available,
  );
  if (!drinkOk) return false;

  const hasCuratedMilks = items.some((item) => item.category === "milk");
  if (!hasCuratedMilks || milkValue === null || slugify(milkValue) === "none") return true;

  const milkSlug = slugify(milkValue);
  return items.some(
    (item) => item.category === "milk" && item.taxonomySlug === milkSlug && item.available,
  );
}
