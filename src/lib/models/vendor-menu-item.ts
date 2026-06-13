import { z } from "zod";

import { optionCategorySchema } from "@/lib/models/option-taxonomy";
import { baseDocumentSchema, moneySenSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * A vendor's offering mapped onto the platform OptionTaxonomy. One item
 * per (vendorId, taxonomySlug). Drinks and add-ons carry a price; milks
 * are availability-only. Sizes and strength are treated as universal in
 * this phase and are not per-vendor menu items.
 *
 * Coverage convention (consumed by the Phase D routing engine): a vendor
 * with *no* menu items is treated as offering the full canonical menu —
 * this preserves v1 behaviour for migrated vendors that haven't curated a
 * menu yet. Once a vendor publishes any item, routing is constrained to
 * what it marked available.
 */
export const vendorMenuItemSchema = baseDocumentSchema.extend({
  vendorId: objectIdSchema,
  category: optionCategorySchema,
  /** References OptionTaxonomy.slug within the same category. */
  taxonomySlug: z.string().min(1),
  available: z.boolean(),
  /** Price in sen (MYR). Required for drinks/add-ons; unset for milks. */
  priceSen: moneySenSchema.optional(),
  /** Optional menu image (Vendor Blob upload integration lands later; a
   * URL is accepted for now). */
  imageUrl: z.string().url().optional(),
});
export type VendorMenuItem = z.infer<typeof vendorMenuItemSchema>;
