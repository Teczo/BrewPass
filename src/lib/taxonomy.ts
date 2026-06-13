import { ADD_ON_LIST } from "@/lib/addons";
import { optionTaxonomyCollection } from "@/lib/collections";
import type { OptionCategory, OptionTaxonomy } from "@/lib/models";
import type { DrinkOptions } from "@/lib/taxonomy-options";

/**
 * The platform OptionTaxonomy: canonical drinks/sizes/milks/strength/add-ons.
 * This module owns the seed list and the pure helpers that operate on it;
 * the migration (phase-c-taxonomy) writes it to the database.
 *
 * Categories that back a DrinkSpec field: drink, size, milk, strength.
 * `value` is the exact token stored in a DrinkSpec; `label` is display.
 */

export interface SeedOption {
  category: OptionCategory;
  value: string;
  label: string;
}

// Broader café-standard set (chosen 2026-06-13): the v1 options plus
// common espresso-bar additions. Vendors map their menu onto these.
const DRINKS = [
  "Flat White",
  "Latte",
  "Cappuccino",
  "Americano",
  "Long Black",
  "Mocha",
  "Espresso",
  "Cold Brew",
  "Piccolo",
  "Macchiato",
  "Cortado",
  "Magic",
  "Affogato",
  "Iced Latte",
  "Flat White Decaf",
];
const MILKS = ["Fresh milk", "Oat", "Almond", "Soy", "None", "Lactose-free", "Coconut"];
// value (lowercase token stored in DrinkSpec) → label (display).
const SIZES: Array<[string, string]> = [
  ["small", "Small"],
  ["regular", "Regular"],
  ["large", "Large"],
];
const STRENGTHS: Array<[string, string]> = [
  ["mild", "Mild"],
  ["regular", "Regular"],
  ["strong", "Strong"],
  ["double", "Double"],
];

/** Canonical seed, ordered. Add-ons are derived from the add-on catalogue
 * so there is a single source of truth for their keys and names. */
export const TAXONOMY_SEED: SeedOption[] = [
  ...DRINKS.map((value): SeedOption => ({ category: "drink", value, label: value })),
  ...SIZES.map(([value, label]): SeedOption => ({ category: "size", value, label })),
  ...MILKS.map((value): SeedOption => ({ category: "milk", value, label: value })),
  ...STRENGTHS.map(([value, label]): SeedOption => ({ category: "strength", value, label })),
  ...ADD_ON_LIST.map(
    (addOn): SeedOption => ({ category: "addon", value: addOn.key, label: addOn.name }),
  ),
];

/** Stable, key-safe slug from a human value. "Flat White" → "flat_white". */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The taxonomy-backed DrinkSpec fields as free strings (a DrinkSpec — whose
 * size/strength are enums — is structurally assignable). Used to validate
 * arbitrary client input against the taxonomy. */
export interface DrinkFields {
  drink: string;
  size: string;
  milk: string;
  strength: string;
}

/** The DrinkSpec fields that are taxonomy-backed, paired with their category. */
export const DRINK_SPEC_CATEGORIES = [
  ["drink", "drink"],
  ["size", "size"],
  ["milk", "milk"],
  ["strength", "strength"],
] as const satisfies ReadonlyArray<readonly [keyof DrinkFields, OptionCategory]>;

/** Active option `value`s grouped by category — the shape used to validate
 * a DrinkSpec without re-querying per field. */
export type TaxonomyValueSets = Record<OptionCategory, Set<string>>;

export function emptyValueSets(): TaxonomyValueSets {
  return {
    drink: new Set(),
    size: new Set(),
    milk: new Set(),
    strength: new Set(),
    addon: new Set(),
  };
}

export function valueSetsFrom(
  entries: Pick<OptionTaxonomy, "category" | "value" | "active">[],
): TaxonomyValueSets {
  const sets = emptyValueSets();
  for (const entry of entries) {
    if (entry.active) sets[entry.category].add(entry.value);
  }
  return sets;
}

/**
 * First DrinkSpec field whose value isn't an active taxonomy member, or
 * null when the drink is fully covered. Fails open when a category has no
 * options at all (taxonomy not seeded yet) so onboarding can't be bricked
 * by deploy ordering — enforcement kicks in once the category is seeded.
 */
export function findUncoveredDrinkField(
  sets: TaxonomyValueSets,
  drink: DrinkFields,
): { field: keyof DrinkFields; value: string } | null {
  for (const [field, category] of DRINK_SPEC_CATEGORIES) {
    const options = sets[category];
    if (options.size === 0) continue; // category not configured — skip
    const value = drink[field];
    if (!options.has(value)) return { field, value };
  }
  return null;
}

export interface TaxonomyOption {
  slug: string;
  value: string;
  label: string;
}
export type GroupedTaxonomy = Record<OptionCategory, TaxonomyOption[]>;

function emptyGroups(): GroupedTaxonomy {
  return { drink: [], size: [], milk: [], strength: [], addon: [] };
}

/** Load active taxonomy options grouped by category, sorted for display. */
export async function loadActiveTaxonomy(): Promise<GroupedTaxonomy> {
  const collection = await optionTaxonomyCollection();
  const docs = await collection
    .find({ active: true })
    .sort({ category: 1, sortOrder: 1 })
    .toArray();
  const groups = emptyGroups();
  for (const doc of docs) {
    groups[doc.category].push({ slug: doc.slug, value: doc.value, label: doc.label });
  }
  return groups;
}

/** Project grouped taxonomy into the {value,label} lists the drink forms use.
 * Returns null when the drink categories are empty (taxonomy not seeded), so
 * callers fall back to DEFAULT_DRINK_OPTIONS. */
export function drinkOptionsFrom(groups: GroupedTaxonomy): DrinkOptions | null {
  if (groups.drink.length === 0) return null;
  const map = (options: TaxonomyOption[]) =>
    options.map((option) => ({ value: option.value, label: option.label }));
  return {
    drinks: map(groups.drink),
    sizes: map(groups.size),
    milks: map(groups.milk),
    strengths: map(groups.strength),
  };
}

/** Active value-sets for validating a submitted DrinkSpec server-side. */
export async function loadDrinkValueSets(): Promise<TaxonomyValueSets> {
  const collection = await optionTaxonomyCollection();
  const docs = await collection
    .find({ active: true })
    .project<{ category: OptionCategory; value: string; active: boolean }>({
      category: 1,
      value: 1,
      active: 1,
    })
    .toArray();
  return valueSetsFrom(docs);
}
