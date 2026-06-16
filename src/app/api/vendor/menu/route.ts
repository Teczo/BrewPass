import { NextResponse } from "next/server";

import { vendorMenuItemsCollection } from "@/lib/collections";
import { writeVendorMenuItem } from "@/lib/menu-write";
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

/** Publish/update a single menu item, mapped onto a taxonomy entry. */
export async function PUT(request: Request) {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await writeVendorMenuItem(
    context.vendor._id,
    await request.json().catch(() => null),
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.issues ? { issues: result.issues } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({ item: result.item });
}
