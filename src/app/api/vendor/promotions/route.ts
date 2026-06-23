import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { vendorPromotionsCollection } from "@/lib/collections";
import {
  drinkSpecSchema,
  localDateSchema,
  localTimeSchema,
  moneySenSchema,
  newDocumentMeta,
  weekdaySchema,
} from "@/lib/models";
import type { VendorPromotion } from "@/lib/models";
import { vendorPromotionToJson } from "@/lib/promotions/serialize";
import { findUncoveredDrinkField, loadDrinkValueSets } from "@/lib/taxonomy";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";

/**
 * Phase K.1/K.2 — vendor promotion management. A vendor creates/manages Packs
 * (K.1), buy-N-get-M bundles, and time-window discounts (K.2). The promo
 * commission rate is NOT vendor-settable (rule #11): packs/bundles fall back to
 * the vendor/platform commission; a promo-specific override is an admin call.
 */
const baseFields = {
  name: z.string().trim().min(1).max(120),
  validFrom: localDateSchema,
  validUntil: localDateSchema,
};

const packSchema = z.object({
  type: z.literal("pack"),
  ...baseFields,
  packSize: z.number().int().positive().max(100),
  packPriceSen: moneySenSchema.refine((v) => v > 0, "pack price must be positive"),
  packMode: z.enum(["fixed_drink", "buyer_choice"]),
  fixedDrink: drinkSpecSchema.optional(),
});

const bundleSchema = z.object({
  type: z.literal("buy_n_get_m"),
  ...baseFields,
  buyQty: z.number().int().positive().max(100),
  freeQty: z.number().int().positive().max(100),
  /** Total bundle price (typically buyQty × the coffee price). */
  packPriceSen: moneySenSchema.refine((v) => v > 0, "bundle price must be positive"),
  packMode: z.enum(["fixed_drink", "buyer_choice"]),
  fixedDrink: drinkSpecSchema.optional(),
});

const windowSchema = z.object({
  type: z.literal("time_window_discount"),
  ...baseFields,
  discountPct: z.number().int().min(1).max(100),
  windowStart: localTimeSchema,
  windowEnd: localTimeSchema,
  applicableDays: z.array(weekdaySchema).min(1).max(7),
});

const createSchema = z
  .discriminatedUnion("type", [packSchema, bundleSchema, windowSchema])
  .refine((v) => v.validFrom <= v.validUntil, {
    message: "validUntil must be on or after validFrom",
  })
  .refine(
    (v) =>
      v.type === "time_window_discount" ||
      v.packMode !== "fixed_drink" ||
      v.fixedDrink !== undefined,
    { message: "fixed_drink packs/bundles need a drink" },
  )
  .refine((v) => v.type !== "time_window_discount" || v.windowStart < v.windowEnd, {
    message: "windowEnd must be after windowStart",
  });

const updateSchema = z.object({
  promotionId: z.string().regex(/^[0-9a-f]{24}$/i),
  status: z.enum(["active", "paused"]),
});

/** List the vendor's promotions (newest first). */
export async function GET() {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const promos = await vendorPromotionsCollection();
  const docs = await promos
    .find({ vendorId: context.vendor._id })
    .sort({ createdAt: -1 })
    .toArray();
  return NextResponse.json({ promotions: docs.map(vendorPromotionToJson) });
}

/** Create a promotion (starts active so it's immediately offerable). */
export async function POST(request: Request) {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // A fixed pack/bundle drink must map onto the platform taxonomy (rule #5).
  if (input.type !== "time_window_discount" && input.fixedDrink) {
    const uncovered = findUncoveredDrinkField(await loadDrinkValueSets(), input.fixedDrink);
    if (uncovered) {
      return NextResponse.json(
        { error: `"${uncovered.value}" isn't an available ${uncovered.field} option.` },
        { status: 422 },
      );
    }
  }

  const now = new Date();
  const common = {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    vendorId: context.vendor._id,
    name: input.name,
    status: "active" as const,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    createdAt: now,
    updatedAt: now,
  };

  let promo: VendorPromotion;
  if (input.type === "pack") {
    promo = {
      ...common,
      type: "pack",
      packSize: input.packSize,
      packPriceSen: input.packPriceSen,
      packMode: input.packMode,
      ...(input.fixedDrink ? { fixedDrink: input.fixedDrink } : {}),
    };
  } else if (input.type === "buy_n_get_m") {
    promo = {
      ...common,
      type: "buy_n_get_m",
      buyQty: input.buyQty,
      freeQty: input.freeQty,
      packPriceSen: input.packPriceSen,
      packMode: input.packMode,
      ...(input.fixedDrink ? { fixedDrink: input.fixedDrink } : {}),
    };
  } else {
    promo = {
      ...common,
      type: "time_window_discount",
      discountPct: input.discountPct,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      applicableDays: input.applicableDays,
    };
  }

  const promos = await vendorPromotionsCollection();
  await promos.insertOne(promo);
  return NextResponse.json(vendorPromotionToJson(promo), { status: 201 });
}

/** Pause or re-activate a promotion (only the owning vendor's). */
export async function PATCH(request: Request) {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const promos = await vendorPromotionsCollection();
  const result = await promos.updateOne(
    { _id: new ObjectId(parsed.data.promotionId), vendorId: context.vendor._id },
    { $set: { status: parsed.data.status, updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) {
    return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
