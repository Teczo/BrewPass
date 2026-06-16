import { ObjectId } from "mongodb";
import { z } from "zod";

import { optionTaxonomyCollection, vendorMenuItemsCollection } from "@/lib/collections";
import type { OptionCategory } from "@/lib/models";
import { vendorMenuItemToJson, type VendorMenuItemJson } from "@/lib/serializers";

/**
 * The single gate for writing a vendor menu item, shared by the manual menu
 * editor (`PUT /api/vendor/menu`) and the AI-onboarding confirm step
 * (Phase C.5). AI-extracted rows must reach `vendorMenuItems` only through
 * this exact validation — never a forked or relaxed path (critical rule #13).
 */

/** Same payload a manual menu edit sends. Reused verbatim by AI confirm. */
export const menuWriteSchema = z.object({
  slug: z.string().min(1),
  available: z.boolean(),
  /** Sen. Required for drinks/add-ons when available; ignored for milks. */
  priceSen: z.number().int().min(0).max(100_000).optional(),
  imageUrl: z.string().url().max(2000).optional(),
});
export type MenuWriteInput = z.infer<typeof menuWriteSchema>;

/**
 * Pure rule check for a parsed input against the taxonomy entry its slug
 * resolves to. Mirrors the manual-edit rules exactly: the slug must be an
 * active taxonomy entry, sizes/strength are not menu-managed, and a priced
 * category needs a price before it can be made available.
 */
export function evaluateMenuWrite(
  input: MenuWriteInput,
  entry: { category: OptionCategory } | null,
): { ok: true; priced: boolean } | { ok: false; error: string } {
  if (!entry) return { ok: false, error: "Unknown or inactive menu option." };
  if (entry.category === "size" || entry.category === "strength") {
    return { ok: false, error: "Sizes and strength are universal and aren't menu-managed." };
  }
  const priced = entry.category === "drink" || entry.category === "addon";
  if (priced && input.available && input.priceSen === undefined) {
    return { ok: false, error: "Set a price for this item before making it available." };
  }
  return { ok: true, priced };
}

export type MenuWriteResult =
  | { ok: true; item: VendorMenuItemJson }
  | { ok: false; status: number; error: string; issues?: unknown };

/**
 * Validate and upsert one vendor menu item. Returns a structured result so
 * callers (a single manual edit, or a confirm loop over AI rows) can surface
 * the error verbatim. Always idempotent on (vendorId, taxonomySlug).
 */
export async function writeVendorMenuItem(
  vendorId: ObjectId,
  rawInput: unknown,
): Promise<MenuWriteResult> {
  const parsed = menuWriteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid input", issues: parsed.error.issues };
  }
  const input = parsed.data;

  // The slug must be an active taxonomy entry; vendors map onto the platform
  // taxonomy, they don't invent options.
  const taxonomy = await optionTaxonomyCollection();
  const entry = await taxonomy.findOne({ slug: input.slug, active: true });
  const decision = evaluateMenuWrite(input, entry);
  if (!decision.ok) return { ok: false, status: 422, error: decision.error };

  const now = new Date();
  const set: Record<string, unknown> = {
    category: entry!.category,
    available: input.available,
    updatedAt: now,
  };
  const unset: Record<string, ""> = {};
  if (decision.priced && input.priceSen !== undefined) set.priceSen = input.priceSen;
  else if (!decision.priced) unset.priceSen = "";
  if (input.imageUrl !== undefined) set.imageUrl = input.imageUrl;
  else unset.imageUrl = "";

  const menuItems = await vendorMenuItemsCollection();
  const updated = await menuItems.findOneAndUpdate(
    { vendorId, taxonomySlug: entry!.slug },
    {
      $set: set,
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      $setOnInsert: { _id: new ObjectId(), vendorId, createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!updated) return { ok: false, status: 500, error: "Failed to save menu item" };

  return { ok: true, item: vendorMenuItemToJson(updated) };
}
