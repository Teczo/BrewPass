import type { ObjectId } from "mongodb";

import { vendorPromotionsCollection } from "@/lib/collections";
import type { Order } from "@/lib/models";

/**
 * Phase K.2 — time-window discounts. A vendor runs a % off individual coffees
 * during a quiet window (e.g. 50% off 2–4pm) to fill demand. The discount is
 * automatic: at generation, an individual coffee routed to that vendor whose
 * delivery falls in the window on an applicable day is priced down, and the
 * lower gross is snapshotted (rule #6). The vendor absorbs the discount —
 * commission and payout simply follow the lower gross. Pack-covered coffees are
 * never discounted here (they're already a discounted product).
 */
export interface TimeWindowPromo {
  vendorPromotionId: ObjectId;
  discountPct: number;
  windowStart: string;
  windowEnd: string;
  applicableDays: number[];
}

/** The best (largest) discount applicable to a delivery at `localTime` on
 * `weekday`, or null when none applies. Window bounds are inclusive. Pure. */
export function bestTimeWindowDiscount(
  promos: TimeWindowPromo[],
  weekday: number,
  localTime: string,
): TimeWindowPromo | null {
  let best: TimeWindowPromo | null = null;
  for (const promo of promos) {
    if (!promo.applicableDays.includes(weekday)) continue;
    // HH:mm strings compare correctly lexicographically.
    if (localTime < promo.windowStart || localTime > promo.windowEnd) continue;
    if (!best || promo.discountPct > best.discountPct) best = promo;
  }
  return best;
}

/** Apply a percentage discount to an integer-sen price, rounding to the nearest
 * sen. Never returns a negative amount. Pure. */
export function applyDiscount(priceSen: number, discountPct: number): number {
  return Math.max(0, Math.round((priceSen * (100 - discountPct)) / 100));
}

/**
 * If a time-window discount applies, mutate the order in place: lower its
 * `priceSen` to the discounted gross and snapshot the applied promo. No-op when
 * the order has no price, is pack-covered, or no promo matches. Returns whether
 * a discount was applied (for summaries).
 */
export function applyTimeWindowDiscountToOrder(
  order: Order,
  promos: TimeWindowPromo[],
  weekday: number,
  localTime: string,
): boolean {
  if (order.priceSen === undefined || order.priceSen <= 0 || order.packCovered) return false;
  const promo = bestTimeWindowDiscount(promos, weekday, localTime);
  if (!promo) return false;

  const originalPriceSen = order.priceSen;
  order.priceSen = applyDiscount(originalPriceSen, promo.discountPct);
  order.appliedPromotion = {
    vendorPromotionId: promo.vendorPromotionId,
    discountPct: promo.discountPct,
    originalPriceSen,
  };
  return true;
}

/** Active time-window discounts for `localDate`, grouped by vendor hex id. */
export async function loadTimeWindowDiscountsByVendor(
  localDate: string,
): Promise<Map<string, TimeWindowPromo[]>> {
  const promos = await vendorPromotionsCollection();
  const docs = await promos
    .find({
      type: "time_window_discount",
      status: "active",
      validFrom: { $lte: localDate },
      validUntil: { $gte: localDate },
    })
    .toArray();

  const map = new Map<string, TimeWindowPromo[]>();
  for (const doc of docs) {
    if (
      doc.discountPct == null ||
      doc.windowStart == null ||
      doc.windowEnd == null ||
      doc.applicableDays == null
    ) {
      continue;
    }
    const entry: TimeWindowPromo = {
      vendorPromotionId: doc._id,
      discountPct: doc.discountPct,
      windowStart: doc.windowStart,
      windowEnd: doc.windowEnd,
      applicableDays: doc.applicableDays,
    };
    const key = doc.vendorId.toHexString();
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return map;
}
