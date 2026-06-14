import { vendorMenuItemsCollection, vendorsCollection } from "@/lib/collections";
import type { GeoPoint } from "@/lib/models";
import { vendorCoversDrink, type CoverageItem } from "@/lib/menu";
import { distanceKm } from "@/lib/order-engine/logic";
import { isWithinServiceArea } from "@/lib/order-engine/routing";
import { slugify } from "@/lib/taxonomy";

/**
 * A vendor presented to a subscriber for preferred-vendor selection. Drives
 * both the manual browse list and the AI recommender's candidate set.
 */
export interface VendorCard {
  id: string;
  name: string;
  address: string;
  distanceKm: number;
  ratingScore: number | null;
  /** Can this vendor make the subscriber's default drink? */
  coversDrink: boolean;
  /** This vendor's price for that drink in sen, when published. */
  priceSen: number | null;
}

/**
 * Active vendors within delivery range of `point`, annotated for the
 * subscriber's default drink, nearest first. The subscriber's preference
 * stays taxonomy-based (critical rule #3); this only ranks vendors for the
 * user to pick from — the platform still routes per order.
 */
export async function loadVendorCardsForUser(
  point: GeoPoint,
  drink: { drink: string; milk: string },
): Promise<VendorCard[]> {
  const [vendors, menuItems] = await Promise.all([
    vendorsCollection(),
    vendorMenuItemsCollection(),
  ]);

  const activeInArea = (await vendors.find({ status: "active" }).toArray()).filter((vendor) =>
    isWithinServiceArea(vendor, point),
  );
  if (activeInArea.length === 0) return [];

  const items = await menuItems
    .find({ vendorId: { $in: activeInArea.map((vendor) => vendor._id) } })
    .toArray();
  const itemsByVendor = new Map<string, CoverageItem[]>();
  const priceByVendorSlug = new Map<string, number>();
  for (const item of items) {
    const key = item.vendorId.toHexString();
    const list = itemsByVendor.get(key) ?? [];
    list.push({
      category: item.category,
      taxonomySlug: item.taxonomySlug,
      available: item.available,
    });
    itemsByVendor.set(key, list);
    if (item.priceSen !== undefined) {
      priceByVendorSlug.set(`${key}:${item.taxonomySlug}`, item.priceSen);
    }
  }

  const drinkSlug = slugify(drink.drink);

  return activeInArea
    .map((vendor): VendorCard => {
      const key = vendor._id.toHexString();
      const vendorItems = itemsByVendor.get(key) ?? [];
      return {
        id: key,
        name: vendor.businessName,
        address: vendor.address,
        distanceKm: Math.round(distanceKm(vendor.geo, point) * 10) / 10,
        ratingScore: vendor.ratingScore ?? null,
        coversDrink: vendorCoversDrink(vendorItems, drink.drink, drink.milk),
        priceSen: priceByVendorSlug.get(`${key}:${drinkSlug}`) ?? null,
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
