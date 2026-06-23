import { z } from "zod";

import {
  baseDocumentSchema,
  drinkSpecSchema,
  localDateSchema,
  localTimeSchema,
  moneySenSchema,
  objectIdSchema,
} from "@/lib/models/shared";

/**
 * Phase K — vendor promotions. A single base entity with a `type` discriminator
 * so Vendor Packs ship first (K.1) and other campaign types (K.2: buy-N-get-M,
 * time-window discounts) extend the same model rather than a retrofit.
 *
 * "Vendor Pack" (type=`pack`) is a vendor-priced discounted product and is
 * DISTINCT from the Phase J office `selectionMode = bundle` (owner picks one
 * drink for everyone) — keep the two concepts separate (critical rule #19).
 */
export const promotionTypeSchema = z.enum(["pack", "buy_n_get_m", "time_window_discount"]);
export type PromotionType = z.infer<typeof promotionTypeSchema>;

export const promotionStatusSchema = z.enum(["draft", "active", "paused", "expired"]);
export type PromotionStatus = z.infer<typeof promotionStatusSchema>;

/** `fixed_drink` = the same coffee ×packSize (drink stored as taxonomy);
 * `buyer_choice` = the buyer picks `packSize` drinks from the vendor's menu,
 * count locked. */
export const packModeSchema = z.enum(["fixed_drink", "buyer_choice"]);
export type PackMode = z.infer<typeof packModeSchema>;

export const vendorPromotionSchema = baseDocumentSchema
  .extend({
    vendorId: objectIdSchema,
    type: promotionTypeSchema,
    name: z.string().min(1).max(120),
    status: promotionStatusSchema,
    /** Campaigns are time-boxed (inclusive local dates). */
    validFrom: localDateSchema,
    validUntil: localDateSchema,
    /**
     * Nullable → falls back to the vendor/platform commission. Lets a promo
     * carry its own commission (a rule #11 business decision); unset means no
     * promo-specific rate is hardcoded — the normal vendor/platform rate applies.
     */
    commissionRateOverrideBps: z.number().int().min(0).max(10_000).optional(),

    // type = pack
    packSize: z.number().int().positive().max(100).optional(),
    packPriceSen: moneySenSchema.optional(),
    packMode: packModeSchema.optional(),
    /** Required when packMode = fixed_drink: the single coffee, ×packSize. */
    fixedDrink: drinkSpecSchema.optional(),

    // type = buy_n_get_m (K.2 — reserved)
    buyQty: z.number().int().positive().optional(),
    freeQty: z.number().int().positive().optional(),

    // type = time_window_discount (K.2 — reserved)
    discountPct: z.number().int().min(1).max(100).optional(),
    windowStart: localTimeSchema.optional(),
    windowEnd: localTimeSchema.optional(),
  })
  .refine((p) => p.validFrom <= p.validUntil, {
    message: "validUntil must be on or after validFrom",
  })
  .refine(
    (p) =>
      p.type !== "pack" ||
      (p.packSize !== undefined && p.packPriceSen !== undefined && p.packMode !== undefined),
    { message: "pack promotions require packSize, packPriceSen, and packMode" },
  )
  .refine((p) => p.type !== "pack" || p.packMode !== "fixed_drink" || p.fixedDrink !== undefined, {
    message: "fixed_drink packs require a fixedDrink",
  });
export type VendorPromotion = z.infer<typeof vendorPromotionSchema>;
