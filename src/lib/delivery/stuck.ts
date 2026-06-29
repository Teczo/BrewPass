import { deliveriesCollection } from "@/lib/collections";
import type { Delivery, DeliveryStatus } from "@/lib/models";

/**
 * Stuck-delivery detection (Phase O.4, `fallbacks.md` §5.6).
 *
 * A courier webhook can silently never arrive, leaving a delivery wedged in an
 * in-flight state forever. This detects those so the operator can intervene
 * (re-dispatch / mark delivered / mark failed) from the admin failures panel.
 * Detection is read-time (no new cron — rule #12): the admin dashboard runs the
 * query on render.
 */

/** Expected door-to-door coffee delivery time. A delivery in flight for more
 * than `STUCK_DELIVERY_MULTIPLIER`× this is considered stuck. Detection-only —
 * this never charges, pays, or changes the state machine, so it is a tunable
 * operational threshold, not a money/cutoff business rule. */
export const STUCK_DELIVERY_EXPECTED_MS = 45 * 60_000; // 45 minutes
export const STUCK_DELIVERY_MULTIPLIER = 2;
export const STUCK_DELIVERY_THRESHOLD_MS = STUCK_DELIVERY_EXPECTED_MS * STUCK_DELIVERY_MULTIPLIER;

/** In-flight states a delivery can get stuck in (pending hasn't dispatched;
 * delivered/failed are terminal). */
const STUCK_STATES: ReadonlySet<DeliveryStatus> = new Set(["assigned", "picked_up"]);

/**
 * Whether a delivery has been in flight past the stuck threshold. Pure +
 * unit-tested. Measured from the most specific in-flight timestamp available
 * (dispatch → assignment → created) so it reflects time actually spent en
 * route, not time since the order was generated.
 */
export function isDeliveryStuck(
  delivery: Pick<Delivery, "status" | "dispatchedAt" | "assignedAt" | "pickedUpAt" | "createdAt">,
  now: Date,
  thresholdMs: number = STUCK_DELIVERY_THRESHOLD_MS,
): boolean {
  if (!STUCK_STATES.has(delivery.status)) return false;
  const anchor =
    delivery.pickedUpAt ?? delivery.dispatchedAt ?? delivery.assignedAt ?? delivery.createdAt;
  return now.getTime() - anchor.getTime() > thresholdMs;
}

/**
 * Every delivery currently stuck in flight (§5.6). The Mongo query narrows to
 * in-flight states; the pure threshold filter applies the time test. Read-time;
 * surfaced in the admin failures panel with a Resolve action.
 */
export async function findStuckDeliveries(now: Date = new Date()): Promise<Delivery[]> {
  const deliveries = await deliveriesCollection();
  const candidates = await deliveries
    .find({ status: { $in: ["assigned", "picked_up"] } })
    .toArray();
  return candidates.filter((delivery) => isDeliveryStuck(delivery, now));
}
