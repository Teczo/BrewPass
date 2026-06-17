import type { ObjectId } from "mongodb";

import { vendorsCollection } from "@/lib/collections";
import type { Order, VendorPayout } from "@/lib/models";
import { emitEvent } from "@/lib/webhooks/dispatch";
import { eventIdFor, orderEventData, payoutEventData } from "@/lib/webhooks/payloads";

/**
 * Typed, non-throwing emit helpers used by the core flows (Phase I.5). They
 * resolve the referenced vendor's `externalId` and hand off to the dispatcher,
 * which only enqueues (never sends inline). Every helper is wrapped so a core
 * action is never blocked or broken by emission (critical rule #13).
 */

/** Order lifecycle event types (all carry the order payload shape). */
export type OrderEventType =
  | "order.scheduled"
  | "vendor.assigned"
  | "order.confirmed"
  | "order.delivered"
  | "order.failed"
  | "refund.issued";

async function vendorExternalId(vendorId: ObjectId): Promise<string | null> {
  const vendors = await vendorsCollection();
  const vendor = await vendors.findOne({ _id: vendorId }, { projection: { externalId: 1 } });
  return vendor?.externalId ?? null;
}

/**
 * Emit an order lifecycle event. Pass the order in the state the event
 * describes (e.g. `{ ...order, status: "confirmed" }`) since the cutoff job
 * holds the pre-transition snapshot. `vendorExternalIdHint` skips the vendor
 * lookup on hot paths; `suffix` keeps repeatable events (reassignment)
 * distinct in the idempotency key.
 */
export async function emitOrderEvent(
  type: OrderEventType,
  order: Order,
  now: Date = new Date(),
  options: { vendorExternalIdHint?: string | null; suffix?: string } = {},
): Promise<void> {
  try {
    const ext =
      options.vendorExternalIdHint !== undefined
        ? options.vendorExternalIdHint
        : await vendorExternalId(order.vendorId);
    await emitEvent(
      eventIdFor(type, order.externalId, options.suffix),
      type,
      orderEventData(order, ext),
      now,
    );
  } catch (error) {
    console.error(`emitOrderEvent(${type}) for ${order.externalId} failed:`, error);
  }
}

/** Emit `payout.released` for a completed vendor transfer. */
export async function emitPayoutReleased(
  payout: VendorPayout,
  now: Date = new Date(),
): Promise<void> {
  try {
    const ext = await vendorExternalId(payout.vendorId);
    await emitEvent(
      eventIdFor("payout.released", payout.externalId),
      "payout.released",
      payoutEventData(payout, ext),
      now,
    );
  } catch (error) {
    console.error(`emitPayoutReleased for ${payout.externalId} failed:`, error);
  }
}
