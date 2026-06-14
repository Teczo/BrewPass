import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { optionTaxonomyCollection, vendorMenuItemsCollection } from "@/lib/collections";
import { vendorMenuItemToJson } from "@/lib/serializers";
import { loadActiveTaxonomy } from "@/lib/taxonomy";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";

/**
 * The vendor's menu: the canonical taxonomy (drinks, milks, add-ons) joined
 * with this vendor's published items. Sizes/strength are universal and not
 * vendor-managed in this phase, so they aren't returned here.
 */
export async function GET() {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [taxonomy, menuItems] = await Promise.all([
    loadActiveTaxonomy(),
    vendorMenuItemsCollection(),
  ]);
  const items = await menuItems.find({ vendorId: context.vendor._id }).toArray();
  const itemBySlug = new Map(items.map((item) => [item.taxonomySlug, item]));

  const sections = (["drink", "milk", "addon"] as const).map((category) => ({
    category,
    options: taxonomy[category].map((option) => {
      const item = itemBySlug.get(option.slug);
      return {
        slug: option.slug,
        label: option.label,
        item: item ? vendorMenuItemToJson(item) : null,
      };
    }),
  }));

  return NextResponse.json({ vendor: { id: context.vendor._id.toHexString() }, sections });
}

const upsertSchema = z.object({
  slug: z.string().min(1),
  available: z.boolean(),
  /** Sen. Required for drinks/add-ons; ignored for milks. */
  priceSen: z.number().int().min(0).max(100_000).optional(),
  imageUrl: z.string().url().max(2000).optional(),
});

/** Publish/update a single menu item, mapped onto a taxonomy entry. */
export async function PUT(request: Request) {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = upsertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // The slug must be an active taxonomy entry; vendors map onto the
  // platform taxonomy, they don't invent options.
  const taxonomy = await optionTaxonomyCollection();
  const entry = await taxonomy.findOne({ slug: input.slug, active: true });
  if (!entry) {
    return NextResponse.json({ error: "Unknown or inactive menu option." }, { status: 422 });
  }
  if (entry.category === "size" || entry.category === "strength") {
    return NextResponse.json(
      { error: "Sizes and strength are universal and aren't menu-managed." },
      { status: 422 },
    );
  }
  // Drinks and add-ons need a price when offered; milks are availability-only.
  const priced = entry.category === "drink" || entry.category === "addon";
  if (priced && input.available && input.priceSen === undefined) {
    return NextResponse.json(
      { error: "Set a price for this item before making it available." },
      { status: 422 },
    );
  }

  const now = new Date();
  const set: Record<string, unknown> = {
    category: entry.category,
    available: input.available,
    updatedAt: now,
  };
  const unset: Record<string, ""> = {};
  if (priced && input.priceSen !== undefined) set.priceSen = input.priceSen;
  else if (!priced) unset.priceSen = "";
  if (input.imageUrl !== undefined) set.imageUrl = input.imageUrl;
  else unset.imageUrl = "";

  const menuItems = await vendorMenuItemsCollection();
  const updated = await menuItems.findOneAndUpdate(
    { vendorId: context.vendor._id, taxonomySlug: entry.slug },
    {
      $set: set,
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      $setOnInsert: { _id: new ObjectId(), vendorId: context.vendor._id, createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!updated) return NextResponse.json({ error: "Failed to save menu item" }, { status: 500 });

  return NextResponse.json({ item: vendorMenuItemToJson(updated) });
}
