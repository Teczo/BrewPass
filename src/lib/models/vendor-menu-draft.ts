import { z } from "zod";

import { baseDocumentSchema, moneySenSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * AI-assisted menu onboarding (Phase C.5). A staging area only: a vendor
 * uploads a menu screenshot, the AI proposes taxonomy-mapped rows, and the
 * vendor reviews/edits before confirming. A draft NEVER feeds routing,
 * charging, or order generation — rows become real VendorMenuItems only when
 * the vendor confirms and each row is replayed through the same menu-write
 * validation a manual edit uses (critical rules #7, #13, #14).
 *
 * One draft per vendor (latest extraction). Source screenshots are processed
 * transiently in-request and are never persisted — only the extracted rows.
 */

export const menuDraftRowSchema = z.object({
  /** The line as read off the menu image, shown to the vendor for context. */
  rawText: z.string().trim().min(1).max(300),
  /** OptionTaxonomy.slug the AI mapped this row to, or null when it couldn't
   * confidently map it ("needs your input" in the UI). */
  matchedTaxonomyRef: z.string().min(1).nullable(),
  /** Price in sen read off the menu, or null when none was detected. */
  proposedPriceSen: moneySenSchema.max(100_000).nullable(),
  /** 0–1 mapping confidence. Advisory display only — it is NEVER used to
   * auto-accept a row (every row is vendor-confirmed). */
  confidence: z.number().min(0).max(1),
});
export type MenuDraftRow = z.infer<typeof menuDraftRowSchema>;

export const vendorMenuDraftSchema = baseDocumentSchema.extend({
  vendorId: objectIdSchema,
  status: z.enum(["proposed", "confirmed"]),
  rows: z.array(menuDraftRowSchema).max(200),
  /** Set when the vendor confirms and rows are replayed into the live menu. */
  confirmedAt: z.date().optional(),
});
export type VendorMenuDraft = z.infer<typeof vendorMenuDraftSchema>;
