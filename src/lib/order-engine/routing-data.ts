import type { ObjectId } from "mongodb";

import { ordersCollection, vendorMenuItemsCollection, vendorsCollection } from "@/lib/collections";
import type { CoverageItem } from "@/lib/menu";
import type { RoutingCandidate } from "@/lib/order-engine/routing";

// Re-export the pure routing surface so callers have one import site.
export { selectVendor } from "@/lib/order-engine/routing";
export type { RoutingCandidate, RoutingRequest, RoutingResult } from "@/lib/order-engine/routing";

/** Order statuses that occupy a vendor's daily capacity (skipped/failed
 * orders freed their slot). */
const CAPACITY_STATUSES = [
  "scheduled",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
] as const;

/**
 * Load the routing candidate set for a date: every active vendor with its
 * published menu items and current assigned-order count. The pure
 * `selectVendor` consumes these; generation mutates `assignedCount` in
 * place as it assigns, so capacity is respected within a single run.
 */
export async function loadRoutingCandidates(localDate: string): Promise<RoutingCandidate[]> {
  const [vendors, menuItems, orders] = await Promise.all([
    vendorsCollection(),
    vendorMenuItemsCollection(),
    ordersCollection(),
  ]);

  const activeVendors = await vendors.find({ status: "active" }).toArray();
  const vendorIds = activeVendors.map((vendor) => vendor._id);

  const [items, counts] = await Promise.all([
    menuItems.find({ vendorId: { $in: vendorIds } }).toArray(),
    // Count per (vendor, KL delivery hour) so routing can enforce both the
    // daily cap (sum over hours) and per-hour slot caps (Phase F).
    orders
      .aggregate<{
        _id: { vendorId: ObjectId; hour: number };
        count: number;
      }>([
        { $match: { date: localDate, status: { $in: [...CAPACITY_STATUSES] } } },
        {
          $group: {
            _id: {
              vendorId: "$vendorId",
              hour: { $hour: { date: "$deliverAt", timezone: "Asia/Kuala_Lumpur" } },
            },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray(),
  ]);

  const itemsByVendor = new Map<string, CoverageItem[]>();
  for (const item of items) {
    const key = item.vendorId.toHexString();
    const list = itemsByVendor.get(key) ?? [];
    list.push({
      category: item.category,
      taxonomySlug: item.taxonomySlug,
      available: item.available,
      ...(item.priceSen !== undefined ? { priceSen: item.priceSen } : {}),
    });
    itemsByVendor.set(key, list);
  }

  // Build per-vendor totals and per-hour breakdowns from the grouped counts.
  const totalByVendor = new Map<string, number>();
  const byHourByVendor = new Map<string, Record<number, number>>();
  for (const row of counts) {
    const key = row._id.vendorId.toHexString();
    totalByVendor.set(key, (totalByVendor.get(key) ?? 0) + row.count);
    const hours = byHourByVendor.get(key) ?? {};
    hours[row._id.hour] = (hours[row._id.hour] ?? 0) + row.count;
    byHourByVendor.set(key, hours);
  }

  return activeVendors.map((vendor) => ({
    vendor,
    menuItems: itemsByVendor.get(vendor._id.toHexString()) ?? [],
    assignedCount: totalByVendor.get(vendor._id.toHexString()) ?? 0,
    assignedByHour: byHourByVendor.get(vendor._id.toHexString()) ?? {},
  }));
}
