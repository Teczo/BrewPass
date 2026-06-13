import { ObjectId } from "mongodb";

import {
  optionTaxonomyCollection,
  preferenceSignalsCollection,
  preferencesCollection,
} from "@/lib/collections";
import type { DrinkSpec, OptionTaxonomy } from "@/lib/models";
import { DRINK_SPEC_CATEGORIES, slugify, TAXONOMY_SEED, type SeedOption } from "@/lib/taxonomy";

/**
 * Phase C migration: seed the OptionTaxonomy and auto-extend it to cover
 * every value existing subscriber preferences (and signal history) already
 * use, so no preference becomes un-saveable after taxonomy validation turns
 * on (chosen strategy: zero data loss). Idempotent and reversible.
 *
 * - `up`: upsert the canonical seed (never clobbering admin/menu edits via
 *   $setOnInsert), then insert any leftover drink/milk/size/strength values
 *   found on preferences or signals as `source: "legacy"` entries.
 * - `down`: drop every taxonomy entry it manages. Vendor menu items are
 *   vendor-authored, not created here, so they are left untouched.
 */

const LEGACY_SORT_BASE = 1000;

/** Identity fields for a seed/legacy option. Pure — unit-tested. */
export function toTaxonomyFields(option: SeedOption, sortOrder: number) {
  return {
    category: option.category,
    slug: slugify(option.value),
    value: option.value,
    label: option.label,
    sortOrder,
  };
}

/**
 * Distinct taxonomy-backed options present across a set of drink specs,
 * keyed by (category, slug). Used to discover legacy values to absorb.
 */
export function distinctDrinkOptions(drinks: DrinkSpec[]): SeedOption[] {
  const byKey = new Map<string, SeedOption>();
  for (const drink of drinks) {
    for (const [field, category] of DRINK_SPEC_CATEGORIES) {
      const value = drink[field];
      if (typeof value !== "string" || value.length === 0) continue;
      const key = `${category}:${slugify(value)}`;
      if (!byKey.has(key)) byKey.set(key, { category, value, label: value });
    }
  }
  return [...byKey.values()];
}

export interface PhaseCMigrationSummary {
  direction: "up" | "down";
  /** up: seed entries newly inserted (existing ones left as-is). */
  seeded: number;
  /** up: legacy values absorbed from preferences/signals. */
  legacyAdded: number;
  /** down: taxonomy entries removed. */
  removed: number;
}

export async function migratePhaseCUp(): Promise<PhaseCMigrationSummary> {
  const taxonomy = await optionTaxonomyCollection();
  const now = new Date();
  const summary: PhaseCMigrationSummary = {
    direction: "up",
    seeded: 0,
    legacyAdded: 0,
    removed: 0,
  };

  // 1. Seed (idempotent): $setOnInsert so re-runs never overwrite later
  //    edits to active/sortOrder/label.
  for (let i = 0; i < TAXONOMY_SEED.length; i += 1) {
    const fields = toTaxonomyFields(TAXONOMY_SEED[i], i);
    const result = await taxonomy.updateOne(
      { category: fields.category, slug: fields.slug },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          ...fields,
          active: true,
          source: "seed" as const,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount === 1) summary.seeded += 1;
  }

  // 2. Auto-extend from existing preference + signal drink specs.
  const [preferences, signals] = await Promise.all([
    preferencesCollection(),
    preferenceSignalsCollection(),
  ]);
  const [prefDocs, signalDocs] = await Promise.all([
    preferences.find({}).project<{ defaultDrink: DrinkSpec }>({ defaultDrink: 1 }).toArray(),
    signals.find({}).project<{ chosenDrink: DrinkSpec }>({ chosenDrink: 1 }).toArray(),
  ]);
  const usedDrinks = [
    ...prefDocs.map((doc) => doc.defaultDrink),
    ...signalDocs.map((doc) => doc.chosenDrink),
  ].filter((drink): drink is DrinkSpec => Boolean(drink));

  const candidates = distinctDrinkOptions(usedDrinks);
  let legacyIndex = 0;
  for (const candidate of candidates) {
    const fields = toTaxonomyFields(candidate, LEGACY_SORT_BASE + legacyIndex);
    const result = await taxonomy.updateOne(
      { category: fields.category, slug: fields.slug },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          ...fields,
          active: true,
          source: "legacy" as const,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount === 1) {
      summary.legacyAdded += 1;
      legacyIndex += 1;
    }
  }

  return summary;
}

export async function migratePhaseCDown(): Promise<PhaseCMigrationSummary> {
  const taxonomy = await optionTaxonomyCollection();
  const result = await taxonomy.deleteMany({
    source: { $in: ["seed", "legacy"] satisfies OptionTaxonomy["source"][] },
  });
  return { direction: "down", seeded: 0, legacyAdded: 0, removed: result.deletedCount };
}
