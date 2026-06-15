import { ObjectId } from "mongodb";

import { ordersCollection } from "@/lib/collections";
import { refundOrderCoffee } from "@/lib/payments/charge";
import { reverseOrderTransfer } from "@/lib/payments/payout";

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

  const result = await refundOrderCoffee(order._id.toHexString(), order.stripeChargeId);
  if (!result.ok) {
    console.error(`Refund for failed delivery ${orderId.toHexString()} failed: ${result.reason}`);
    return;
  }
  await orders.updateOne(
    { _id: orderId },
    { $set: { chargeStatus: "refunded" as const, refundedAt: now, updatedAt: now } },
  );
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
}
