import { ObjectId } from "mongodb";

import { ordersCollection, vendorPayoutsCollection, vendorsCollection } from "@/lib/collections";
import { newDocumentMeta } from "@/lib/models";
import type { Order, Vendor } from "@/lib/models";
import { buildPayoutBatch, type PayoutLine } from "@/lib/payments/money";
import { getStripe } from "@/lib/stripe";
import { emitPayoutReleased } from "@/lib/webhooks/emit";

/**
 * Delivery-gated vendor payouts (Phase E, critical rule #4). The subscriber
 * was charged the gross into the platform balance at cutoff; here — only
 * after delivery — we transfer the vendor's net (gross minus commission, both
 * snapshotted at charge time) to their Stripe connected account.
 *
 * Cadence (vendor's choice) only changes how often funds are swept, never
 * whether payout happens:
 *  - `per_order`  → transfer the moment an order is delivered.
 *  - `daily_batch` (default) → one transfer per vendor per day, via the sweep.
 *
 * All transfers use idempotency keys so a re-run or duplicate delivery event
 * can never double-pay (critical rule #1). A vendor that isn't Connect-ready
 * leaves orders `pending`; the next sweep retries once they onboard.
 */

/** A delivered order is payable when it was actually charged and carries a
 * net snapshot, and hasn't already been paid or reversed. */
export function isPayable(order: Order): boolean {
  return (
    order.status === "delivered" &&
    order.chargeStatus === "charged" &&
    typeof order.vendorNetAmountSen === "number" &&
    order.vendorNetAmountSen > 0 &&
    order.payoutStatus !== "paid" &&
    order.payoutStatus !== "reversed"
  );
}

function payoutLine(order: Order): PayoutLine {
  return {
    orderId: order._id,
    grossSen: order.priceSen ?? 0,
    commissionSen: order.commissionAmountSen ?? 0,
    vendorNetSen: order.vendorNetAmountSen ?? 0,
  };
}

function vendorCanReceive(vendor: Vendor): boolean {
  return Boolean(vendor.stripeConnectAccountId) && vendor.connectPayoutsEnabled === true;
}

function effectiveCadence(vendor: Vendor): "per_order" | "daily_batch" {
  return vendor.payoutCadence ?? "daily_batch";
}

/**
 * Mark an order delivered as awaiting payout, and — for `per_order` vendors —
 * transfer immediately. For `daily_batch` (the default) it just sets
 * `payoutStatus: pending` and leaves the money for the sweep. Safe to call
 * more than once per order (idempotent transfer key + payable guard).
 */
export async function handleOrderDelivered(
  orderId: ObjectId,
  now: Date = new Date(),
): Promise<void> {
  const orders = await ordersCollection();
  const order = await orders.findOne({ _id: orderId });
  if (!order || !isPayable(order)) return;

  // Record that the net is now owed (gates the sweep / statements).
  if (order.payoutStatus !== "pending") {
    await orders.updateOne(
      { _id: order._id },
      { $set: { payoutStatus: "pending" as const, updatedAt: now } },
    );
  }

  const vendors = await vendorsCollection();
  const vendor = await vendors.findOne({ _id: order.vendorId });
  if (!vendor || effectiveCadence(vendor) !== "per_order" || !vendorCanReceive(vendor)) return;

  await transferBatch({
    vendor,
    lines: [payoutLine(order)],
    cadence: "per_order",
    period: order.date,
    idempotencyKey: `transfer_${order._id.toHexString()}`,
    now,
  });
}

export interface SweepSummary {
  date: string;
  vendorsPaid: number;
  ordersPaid: number;
  transferredSen: number;
  skipped: Array<{ vendorId: string; reason: string }>;
}

/**
 * Daily batch sweep: for every vendor with delivered-but-unpaid orders on
 * `localDate`, create one transfer covering them all. Idempotent via the
 * unique (vendorId, period, daily_batch) payout index and the per-batch
 * transfer key. Also sweeps per_order vendors whose immediate transfer was
 * deferred because they weren't Connect-ready at delivery time.
 */
export async function sweepDailyBatchPayouts(
  localDate: string,
  now: Date = new Date(),
): Promise<SweepSummary> {
  const orders = await ordersCollection();
  const vendors = await vendorsCollection();
  const summary: SweepSummary = {
    date: localDate,
    vendorsPaid: 0,
    ordersPaid: 0,
    transferredSen: 0,
    skipped: [],
  };

  const vendorIds = await orders.distinct("vendorId", {
    date: localDate,
    status: "delivered",
    chargeStatus: "charged",
    payoutStatus: "pending",
  });

  for (const vendorId of vendorIds) {
    const vendor = await vendors.findOne({ _id: vendorId });
    if (!vendor) continue;
    if (!vendorCanReceive(vendor)) {
      summary.skipped.push({
        vendorId: vendorId.toHexString(),
        reason: "vendor_not_connect_ready",
      });
      continue;
    }

    const payable = (
      await orders
        .find({ vendorId, date: localDate, status: "delivered", payoutStatus: "pending" })
        .toArray()
    ).filter(isPayable);
    if (payable.length === 0) continue;

    const result = await transferBatch({
      vendor,
      lines: payable.map(payoutLine),
      cadence: effectiveCadence(vendor),
      period: localDate,
      idempotencyKey: `batch_${vendorId.toHexString()}_${localDate}`,
      now,
    });
    if (result.ok) {
      summary.vendorsPaid += 1;
      summary.ordersPaid += payable.length;
      summary.transferredSen += result.netSen;
    } else {
      summary.skipped.push({
        vendorId: vendorId.toHexString(),
        reason: result.reason ?? "transfer_failed",
      });
    }
  }
  return summary;
}

/**
 * Reverse a paid-out transfer (Phase E) — used when a delivered order is
 * disputed/refunded. Reclaims the vendor's net from their connected account
 * and marks the order + payout `reversed`. Idempotent via `reversal_<orderId>`
 * and the paid-status guard.
 */
export async function reverseOrderTransfer(
  orderId: ObjectId,
  now: Date = new Date(),
): Promise<void> {
  const orders = await ordersCollection();
  const order = await orders.findOne({ _id: orderId });
  if (!order || order.payoutStatus !== "paid" || !order.stripeTransferId) return;
  if (typeof order.vendorNetAmountSen !== "number" || order.vendorNetAmountSen <= 0) return;

  await getStripe().transfers.createReversal(
    order.stripeTransferId,
    { amount: order.vendorNetAmountSen, metadata: { orderId: orderId.toHexString() } },
    { idempotencyKey: `reversal_${orderId.toHexString()}` },
  );

  await orders.updateOne(
    { _id: orderId },
    { $set: { payoutStatus: "reversed" as const, updatedAt: now } },
  );
  if (order.vendorPayoutId) {
    const payouts = await vendorPayoutsCollection();
    await payouts.updateOne(
      { _id: order.vendorPayoutId },
      { $set: { status: "reversed" as const, updatedAt: now } },
    );
  }
}

interface TransferOutcome {
  ok: boolean;
  reason?: string;
  netSen: number;
}

/**
 * Core money move: record the VendorPayout, create the Stripe transfer to the
 * connected account, then mark the payout and its orders paid. The payout doc
 * is upserted first so a crash mid-transfer leaves a recoverable record; the
 * idempotency key guarantees the transfer itself happens at most once.
 */
async function transferBatch(args: {
  vendor: Vendor;
  lines: PayoutLine[];
  cadence: "per_order" | "daily_batch";
  period: string;
  idempotencyKey: string;
  now: Date;
}): Promise<TransferOutcome> {
  const { vendor, lines, cadence, period, idempotencyKey, now } = args;
  const batch = buildPayoutBatch(lines);
  if (batch.netSen <= 0) return { ok: true, netSen: 0 };

  const [orders, payouts] = await Promise.all([ordersCollection(), vendorPayoutsCollection()]);
  const accountId = vendor.stripeConnectAccountId!;

  // Upsert the payout record. daily_batch is unique per (vendor, period); a
  // re-run finds the existing row instead of creating a second.
  const filter =
    cadence === "daily_batch"
      ? { vendorId: vendor._id, period, cadence }
      : { vendorId: vendor._id, period, cadence, orderIds: batch.orderIds };
  const payout = await payouts.findOneAndUpdate(
    filter,
    {
      $set: {
        vendorId: vendor._id,
        period,
        cadence,
        orderIds: batch.orderIds,
        grossSen: batch.grossSen,
        commissionSen: batch.commissionSen,
        netSen: batch.netSen,
        stripeConnectAccountId: accountId,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: new ObjectId(),
        ...newDocumentMeta(),
        status: "pending" as const,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  let transferId: string;
  try {
    const transfer = await getStripe().transfers.create(
      {
        amount: batch.netSen,
        currency: "myr",
        destination: accountId,
        metadata: {
          vendorId: vendor._id.toHexString(),
          period,
          cadence,
          payoutId: payout!._id.toHexString(),
        },
      },
      { idempotencyKey },
    );
    transferId = transfer.id;
  } catch (error) {
    const reason =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "transfer_failed")
        : "transfer_failed";
    await payouts.updateOne(
      { _id: payout!._id },
      { $set: { status: "failed" as const, failureReason: reason, updatedAt: now } },
    );
    return { ok: false, reason, netSen: 0 };
  }

  await payouts.updateOne(
    { _id: payout!._id },
    { $set: { status: "paid" as const, stripeTransferId: transferId, updatedAt: now } },
  );
  await orders.updateMany(
    { _id: { $in: batch.orderIds } },
    {
      $set: {
        payoutStatus: "paid" as const,
        stripeTransferId: transferId,
        vendorPayoutId: payout!._id,
        updatedAt: now,
      },
    },
  );

  // Phase I.5: best-effort outbound event for the released (delivery-gated)
  // payout. Never blocks or alters the money move (critical rule #13).
  await emitPayoutReleased({ ...payout!, status: "paid", stripeTransferId: transferId }, now);

  return { ok: true, netSen: batch.netSen };
}
