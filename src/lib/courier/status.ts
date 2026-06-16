import type { CourierProvider, DeliveryStatus } from "@/lib/models";

/**
 * Pure courier-status logic (v2.1) — deterministic and unit-tested. Maps raw
 * provider statuses onto the `Delivery` state machine and enforces the
 * "never move backwards" rule that makes out-of-order, retried webhooks safe
 * (critical rule #6). The webhook service wraps these with database I/O.
 */

/**
 * Monotonic rank of each Delivery state. A webhook only ever advances the
 * state machine (rank strictly increases); `delivered` and `failed` are both
 * terminal, so neither can flip to the other.
 */
const RANK: Record<DeliveryStatus, number> = {
  pending: 0,
  assigned: 1,
  picked_up: 2,
  delivered: 3,
  failed: 3,
};

/** True when `target` is a forward transition from `current`. */
export function isForwardTransition(current: DeliveryStatus, target: DeliveryStatus): boolean {
  return RANK[target] > RANK[current];
}

export function isTerminalStatus(status: DeliveryStatus): boolean {
  return status === "delivered" || status === "failed";
}

/**
 * Whether an inbound courier event should drive the state machine to `target`.
 * Encodes the out-of-order/retry rules (critical rule #6):
 *  - never leave a terminal state (`delivered`/`failed`) for a different one;
 *  - never move backwards;
 *  - allow re-applying the *same* state (idempotency claim dedups real
 *    duplicates; equality is what lets a failed-then-retried event reprocess).
 */
export function shouldApplyTransition(current: DeliveryStatus, target: DeliveryStatus): boolean {
  if (isTerminalStatus(current)) return target === current;
  return RANK[target] >= RANK[current];
}

/** Prior states a delivery may legally be in to advance to `target` — the
 * filter for the atomic conditional update (mirrors the manual flow). */
export function priorStatesFor(target: DeliveryStatus): DeliveryStatus[] {
  return (Object.keys(RANK) as DeliveryStatus[]).filter((s) => RANK[s] < RANK[target]);
}

/** Lalamove v3 order statuses → Delivery state, or null for info-only states
 * (driver being assigned, en route to pickup) that carry no transition. */
export function mapLalamoveStatus(raw: string): DeliveryStatus | null {
  switch (raw.toUpperCase()) {
    case "PICKED_UP":
      return "picked_up";
    case "COMPLETED":
      return "delivered";
    case "CANCELED":
    case "CANCELLED":
    case "REJECTED":
    case "EXPIRED":
      return "failed";
    // ASSIGNING_DRIVER / ON_GOING / PENDING etc. — no state-machine change.
    default:
      return null;
  }
}

/** Provider-dispatching status mapper. Grab maps onto the same neutral states
 * when its adapter lands; until then only Lalamove is wired. */
export function mapCourierStatus(provider: CourierProvider, raw: string): DeliveryStatus | null {
  switch (provider) {
    case "lalamove":
    case "grab":
      // Grab's status vocabulary is close enough to reuse for now; the Grab
      // adapter can override this when its exact statuses are confirmed.
      return mapLalamoveStatus(raw);
    case "manual":
      return null;
  }
}
