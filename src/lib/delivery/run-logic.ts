import type { ObjectId } from "mongodb";

import type { DeliveryRunStatus, OrderStatus, PickupStop } from "@/lib/models";

/**
 * Phase L.1 / L.2 — pure, DB-free logic for consolidated delivery runs. Keeping
 * grouping, composition validation, and status derivation as pure functions
 * (the codebase idiom) lets them be unit-tested without a database; the thin
 * orchestration in `runs.ts` calls these.
 */

/** The minimum an Order must expose for a run to reason about it. */
export interface RunOrderView {
  orderId: ObjectId;
  vendorId: ObjectId;
  status: OrderStatus;
  /** The drop the Order is delivered to — a run requires one shared location. */
  locationId: ObjectId;
  /** Set when this Order is part of a Vendor Pack (rule #22 — packs can't join a run). */
  packPurchaseId?: ObjectId;
  /** Set when the Order is already grouped into another run. */
  deliveryRunId?: ObjectId;
}

export type RunValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "empty"
        | "single_order"
        | "contains_pack_order"
        | "mixed_drop_location"
        | "already_in_run"
        | "uncombinable_status";
    };

/**
 * Statuses an Order may hold when it is grouped into a run. A run is the
 * DELIVERY grouping, formed once the day's coffees are charged and being made —
 * already-finished or never-charged Orders can't be consolidated.
 */
const COMBINABLE_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "confirmed",
  "preparing",
  "out_for_delivery",
]);

/**
 * Validate that a set of Orders may form one consolidated run. Enforces the
 * rule #22 invariants: at least two Orders, none belonging to a Vendor Pack
 * (packs are single-vendor and don't reroute), all delivered to the SAME drop,
 * none already in another run, and all in a state that can still be delivered.
 */
export function validateRunComposition(orders: RunOrderView[]): RunValidationResult {
  if (orders.length === 0) return { ok: false, reason: "empty" };
  // A "run" with one Order is just an ordinary single-vendor delivery — no
  // consolidation to do. Keep those on the unchanged single-order path.
  if (orders.length < 2) return { ok: false, reason: "single_order" };

  if (orders.some((o) => o.packPurchaseId != null)) {
    return { ok: false, reason: "contains_pack_order" };
  }
  if (orders.some((o) => o.deliveryRunId != null)) {
    return { ok: false, reason: "already_in_run" };
  }
  if (orders.some((o) => !COMBINABLE_STATUSES.has(o.status))) {
    return { ok: false, reason: "uncombinable_status" };
  }
  const firstDrop = orders[0].locationId.toHexString();
  if (orders.some((o) => o.locationId.toHexString() !== firstDrop)) {
    return { ok: false, reason: "mixed_drop_location" };
  }
  return { ok: true };
}

/**
 * Group Orders into per-vendor pickup stops, preserving first-seen vendor
 * order as the planned route order. Multiple Orders for the same vendor share
 * one stop (the rider collects them together).
 */
export function groupOrdersIntoStops(orders: RunOrderView[]): PickupStop[] {
  const byVendor = new Map<string, PickupStop>();
  const routeOrder: string[] = [];
  for (const order of orders) {
    const key = order.vendorId.toHexString();
    let stop = byVendor.get(key);
    if (!stop) {
      stop = { vendorId: order.vendorId, orderIds: [] };
      byVendor.set(key, stop);
      routeOrder.push(key);
    }
    stop.orderIds.push(order.orderId);
  }
  return routeOrder.map((key) => byVendor.get(key)!);
}

/**
 * Derive a run's aggregate status from its member Orders' statuses (L.2).
 * Confirmation is strictly per-Order — this is a read-only rollup for display
 * and ops, never a gate on charging, payout, or refund.
 *
 * - all member Orders `delivered` → `completed`
 * - all member Orders `failed`/`skipped` → `failed`
 * - some delivered, the rest terminal (failed/skipped) → `partially_failed`
 * - otherwise still in flight → `dispatched` if a courier job is live, else
 *   `planned`.
 */
export function deriveRunStatus(
  orderStatuses: OrderStatus[],
  options: { dispatched?: boolean } = {},
): DeliveryRunStatus {
  const total = orderStatuses.length;
  const delivered = orderStatuses.filter((s) => s === "delivered").length;
  // `skipped` (never charged) and `failed` are both terminal non-deliveries.
  const terminalNonDelivery = orderStatuses.filter((s) => s === "failed" || s === "skipped").length;
  const settled = delivered + terminalNonDelivery;

  if (total > 0 && settled === total) {
    if (delivered === total) return "completed";
    if (delivered === 0) return "failed";
    return "partially_failed";
  }
  return options.dispatched ? "dispatched" : "planned";
}
