import type { Order, VendorPayout, WebhookEventType } from "@/lib/models";

/**
 * Pure builders for outbound webhook event data (Phase I.5). Every payload is
 * keyed by `externalId` and references other entities by their `externalId`,
 * never a raw Mongo `_id` (critical rule #14). Unit-tested.
 */

/** Stable idempotency key for a logical event. Including the type means the
 * same order can emit distinct lifecycle events; an explicit `suffix`
 * (e.g. the new vendor on a reassignment) keeps repeatable events distinct. */
export function eventIdFor(type: WebhookEventType, externalId: string, suffix?: string): string {
  return suffix ? `${type}:${externalId}:${suffix}` : `${type}:${externalId}`;
}

export function orderEventData(
  order: Order,
  vendorExternalId: string | null,
): Record<string, unknown> {
  return {
    id: order.externalId,
    status: order.status,
    date: order.date,
    drink: order.drink,
    vendorId: vendorExternalId,
    assignmentMethod: order.assignmentMethod ?? null,
    priceSen: order.priceSen ?? null,
    chargeStatus: order.chargeStatus ?? null,
    payoutStatus: order.payoutStatus ?? null,
    failureReason: order.failureReason ?? null,
  };
}

export function payoutEventData(
  payout: VendorPayout,
  vendorExternalId: string | null,
): Record<string, unknown> {
  return {
    id: payout.externalId,
    vendorId: vendorExternalId,
    period: payout.period,
    cadence: payout.cadence,
    grossSen: payout.grossSen,
    commissionSen: payout.commissionSen,
    netSen: payout.netSen,
    status: payout.status,
    orderCount: payout.orderIds.length,
  };
}
