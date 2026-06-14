import { z } from "zod";

import { baseDocumentSchema } from "@/lib/models/shared";

/**
 * Canonical option categories. `drink`, `size`, `milk`, and `strength`
 * map onto the four catalogue dimensions of a DrinkSpec; `addon` mirrors
 * the add-on catalogue. `sugar` is a 0–5 quantity, not a catalogue choice,
 * so it is deliberately not part of the taxonomy.
 */
export const optionCategorySchema = z.enum(["drink", "size", "milk", "strength", "addon"]);
export type OptionCategory = z.infer<typeof optionCategorySchema>;

/**
 * Platform-level OptionTaxonomy — the single source of truth for the
 * canonical options subscriber preferences point to (critical rule #3).
 * Vendors map their offerings onto these entries via VendorMenuItem, and
 * preference values are validated against them, which is what keeps
 * auto-orders portable when a subscriber is routed to a different vendor.
 */
export const optionTaxonomySchema = baseDocumentSchema.extend({
  category: optionCategorySchema,
  /** Stable, URL/key-safe identity, unique within a category. The join key
   * used by VendorMenuItem and routing menu-coverage checks. */
  slug: z.string().min(1),
  /** The exact token stored in a DrinkSpec for this option (e.g. size
   * "regular", drink "Flat White"); equals the add-on key for `addon`. */
  value: z.string().min(1),
  /** Human-facing display label. */
  label: z.string().min(1),
  sortOrder: z.number().int(),
  active: z.boolean(),
  /** `seed` = platform-curated; `legacy` = auto-added by the Phase C
   * migration to cover a value an existing preference already used. */
  source: z.enum(["seed", "legacy"]),
});
export type OptionTaxonomy = z.infer<typeof optionTaxonomySchema>;
