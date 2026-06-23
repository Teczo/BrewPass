import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { vendorPromotionsCollection } from "@/lib/collections";
import { drinkSpecSchema, localDateSchema, moneySenSchema, newDocumentMeta } from "@/lib/models";
import type { VendorPromotion } from "@/lib/models";
import { vendorPromotionToJson } from "@/lib/promotions/serialize";
import { findUncoveredDrinkField, loadDrinkValueSets } from "@/lib/taxonomy";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";

/**
 * Phase K.1 — vendor Pack management. A vendor creates/manages Packs
 * (`VendorPromotion` of type `pack`). The promo commission rate is NOT
 * vendor-settable here (rule #11): packs fall back to the vendor/platform
 * commission; a promo-specific override is an admin decision.
 */
const createPackSchema = z
  .object({
    type: z.literal("pack").default("pack"),
    name: z.string().trim().min(1).max(120),
    validFrom: localDateSchema,
    validUntil: localDateSchema,
    packSize: z.number().int().positive().max(100),
    packPriceSen: moneySenSchema.refine((v) => v > 0, "pack price must be positive"),
    packMode: z.enum(["fixed_drink", "buyer_choice"]),
    /** Required when packMode = fixed_drink. */
    fixedDrink: drinkSpecSchema.optional(),
  })
  .refine((v) => v.validFrom <= v.validUntil, {
    message: "validUntil must be on or after validFrom",
  })
  .refine((v) => v.packMode !== "fixed_drink" || v.fixedDrink !== undefined, {
    message: "fixed_drink packs need a drink",
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

/** Create a Pack promotion (starts active so it's immediately offerable). */
export async function POST(request: Request) {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createPackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // A fixed pack drink must map onto the platform taxonomy (rule #5).
  if (input.fixedDrink) {
    const uncovered = findUncoveredDrinkField(await loadDrinkValueSets(), input.fixedDrink);
    if (uncovered) {
      return NextResponse.json(
        { error: `"${uncovered.value}" isn't an available ${uncovered.field} option.` },
        { status: 422 },
      );
    }
  }

  const now = new Date();
  const promo: VendorPromotion = {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    vendorId: context.vendor._id,
    type: "pack",
    name: input.name,
    status: "active",
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    packSize: input.packSize,
    packPriceSen: input.packPriceSen,
    packMode: input.packMode,
    ...(input.fixedDrink ? { fixedDrink: input.fixedDrink } : {}),
    createdAt: now,
    updatedAt: now,
  };
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
