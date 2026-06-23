import { ObjectId } from "mongodb";

import { ordersCollection } from "@/lib/collections";
import { refundOrderCoffee } from "@/lib/payments/charge";
import { reverseOrderTransfer } from "@/lib/payments/payout";
import { emitOrderEvent } from "@/lib/webhooks/emit";

/**
 * Refund / dispute handling (Phase E, critical rule #4 & #9).
 *
 * - Delivery fails after the user was charged → refund the user; no transfer
 *   was ever released (payout is delivery-gated), so nothing to reverse.
 * - Delivered then disputed → the card network already pulls the funds, so we
 *   reverse the vendor's transfer to reclaim the net and mark the order
 *   refunded; we never also issue a Stripe refund (that would double-refund).
 */

/** Refund the coffee charge for an order whose delivery failed. No-op when
 * the order was never charged. Idempotent (Stripe refund key + status guard). */
export async function refundFailedDelivery(
  orderId: ObjectId,
  now: Date = new Date(),
): Promise<void> {
  const orders = await ordersCollection();
  const order = await orders.findOne({ _id: orderId });
  if (!order || order.chargeStatus !== "charged" || !order.stripeChargeId) return;

  // Phase K.1: a pack-covered coffee shares one PaymentIntent with the rest of
  // the pack, so refund only this slot's allocated share (its priceSen).
  // Non-pack orders refund the whole intent (amount omitted).
  const partialAmountSen = order.packCovered ? order.priceSen : undefined;
  const result = await refundOrderCoffee(
    order._id.toHexString(),
    order.stripeChargeId,
    partialAmountSen,
  );
  if (!result.ok) {
    console.error(`Refund for failed delivery ${orderId.toHexString()} failed: ${result.reason}`);
    return;
  }
  await orders.updateOne(
    { _id: orderId },
    { $set: { chargeStatus: "refunded" as const, refundedAt: now, updatedAt: now } },
  );
  await emitOrderEvent("refund.issued", { ...order, chargeStatus: "refunded" }, now);
}

/**
 * Handle a dispute on a coffee charge: reverse the vendor's transfer if one
 * was already paid, and mark the order refunded so no future payout is
 * released. Resolves the order by its charge PaymentIntent id.
 */
export async function handleChargeDispute(
  paymentIntentId: string,
  now: Date = new Date(),
): Promise<void> {
  const orders = await ordersCollection();
  const order = await orders.findOne({ stripeChargeId: paymentIntentId });
  if (!order) return;

  // Reclaim the vendor's net if it was already transferred.
  if (order.payoutStatus === "paid") {
    await reverseOrderTransfer(order._id, now);
  }
  // The dispute itself returns the money to the user; just record it.
  await orders.updateOne(
    { _id: order._id },
    { $set: { chargeStatus: "refunded" as const, refundedAt: now, updatedAt: now } },
  );
  await emitOrderEvent("refund.issued", { ...order, chargeStatus: "refunded" }, now);
}

export type AdminRefundResult =
  | { ok: true; reversedTransfer: boolean }
  | { ok: false; reason: "not_charged" | "already_refunded" | string };

/**
 * Operator-initiated money refund (Phase H). Issues a Stripe refund for the
 * coffee charge and reverses the vendor's transfer if it was already paid out
 * — the manual equivalent of a dispute, surfaced to the admin tools. Errors
 * are returned (not swallowed) so the operator sees them. Idempotent via the
 * Stripe refund/reversal keys and the chargeStatus guard.
 */
export async function refundChargedOrder(
  orderId: ObjectId,
  now: Date = new Date(),
): Promise<AdminRefundResult> {
  const orders = await ordersCollection();
  const order = await orders.findOne({ _id: orderId });
  if (!order) return { ok: false, reason: "not_charged" };
  if (order.chargeStatus === "refunded") return { ok: false, reason: "already_refunded" };
  if (order.chargeStatus !== "charged" || !order.stripeChargeId) {
    return { ok: false, reason: "not_charged" };
  }

  const result = await refundOrderCoffee(order._id.toHexString(), order.stripeChargeId);
  if (!result.ok) return { ok: false, reason: result.reason };

  await orders.updateOne(
    { _id: orderId },
    { $set: { chargeStatus: "refunded" as const, refundedAt: now, updatedAt: now } },
  );

  let reversedTransfer = false;
  if (order.payoutStatus === "paid") {
    await reverseOrderTransfer(order._id, now);
    reversedTransfer = true;
  }
  await emitOrderEvent("refund.issued", { ...order, chargeStatus: "refunded" }, now);
  return { ok: true, reversedTransfer };
}
