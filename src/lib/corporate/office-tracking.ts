import type { ObjectId } from "mongodb";

import { corporateAccountsCollection, ordersCollection } from "@/lib/collections";
import type { CorporateAccount, OrderStatus } from "@/lib/models";
import { formatLocalTime12h, localDateOf, localTimeOf } from "@/lib/time";

/**
 * Phase J.6 — lightweight member tracking for OFFICE coffee. Members get the
 * coffee details + ETA + status; the live map (reused from the personal
 * DeliveryTracker) is optional. The existing per-order tracking route already
 * works for office orders (they carry the member's own userId), so this only
 * assembles the compact "arriving ~9:05 · Flat White · Level 12" list.
 *
 * Forward-compatible with Phase L (consolidated delivery): the view is a flat
 * list of office-coffee items and must NOT assume one delivery = one order. When
 * `DeliveryRun` lands, several of these items will share a single delivery; the
 * shape here (per-order items, each independently trackable) lets L group them
 * without reworking the member view.
 */

/** Lifecycle states worth surfacing: active, plus just-delivered for the day. */
const SURFACED_STATUSES: OrderStatus[] = [
  "scheduled",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
];

/** Only an out-for-delivery order has a live driver/map to track. */
export function isLiveTrackable(status: OrderStatus): boolean {
  return status === "out_for_delivery";
}

/** Compact, member-facing status copy for an office coffee. */
export function officeTrackingStatusLabel(status: OrderStatus): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "confirmed":
      return "Confirmed";
    case "preparing":
      return "Being made";
    case "out_for_delivery":
      return "On its way";
    case "delivered":
      return "Delivered";
    case "skipped":
      return "Skipped";
    case "failed":
      return "Didn't arrive";
  }
}

export interface OfficeCoffeeItem {
  orderId: string;
  date: string;
  drinkName: string;
  /** Secondary line, e.g. "regular · Oat". */
  detail: string;
  status: OrderStatus;
  statusLabel: string;
  /** Local delivery time, e.g. "9:05 AM". */
  etaLabel: string;
  locationLabel: string;
  company: string;
  /** True when there's a live driver/map to follow right now. */
  trackable: boolean;
}

/**
 * The member's upcoming/today office coffees (today onward), oldest delivery
 * time first. Skipped/failed days are omitted — the tracking view is about
 * coffees that are actually coming (or just arrived).
 */
export async function listMemberOfficeCoffees(
  userId: ObjectId,
  now: Date = new Date(),
): Promise<OfficeCoffeeItem[]> {
  const today = localDateOf(now);
  const orders = await ordersCollection();
  const docs = await orders
    .find({
      userId,
      source: "corporate",
      date: { $gte: today },
      status: { $in: SURFACED_STATUSES },
    })
    .sort({ deliverAt: 1 })
    .toArray();
  if (docs.length === 0) return [];

  const accountIds = [
    ...new Map(
      docs
        .filter((o) => o.corporateAccountId)
        .map((o) => [o.corporateAccountId!.toHexString(), o.corporateAccountId!]),
    ).values(),
  ];
  const accounts = await corporateAccountsCollection();
  const accountDocs = await accounts.find({ _id: { $in: accountIds } }).toArray();
  const accountById = new Map<string, CorporateAccount>(
    accountDocs.map((a) => [a._id.toHexString(), a]),
  );

  return docs.map((order) => ({
    orderId: order._id.toHexString(),
    date: order.date,
    drinkName: order.drink.drink,
    detail: `${order.drink.size} · ${order.drink.milk}`,
    status: order.status,
    statusLabel: officeTrackingStatusLabel(order.status),
    etaLabel: formatLocalTime12h(localTimeOf(order.deliverAt)),
    locationLabel: order.location.label,
    company: order.corporateAccountId
      ? (accountById.get(order.corporateAccountId.toHexString())?.company ?? "your office")
      : "your office",
    trackable: isLiveTrackable(order.status),
  }));
}
