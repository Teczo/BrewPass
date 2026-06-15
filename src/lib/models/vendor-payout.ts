import { z } from "zod";

import { baseDocumentSchema, moneySenSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * `pending` exists only transiently while a transfer is being created;
 * a successful sweep writes `paid`. `failed` records a transfer error for
 * retry; `reversed` marks a payout clawed back after a dispute/refund.
 */
export const payoutStatusSchema = z.enum(["pending", "paid", "failed", "reversed"]);
export type PayoutStatus = z.infer<typeof payoutStatusSchema>;

/**
 * A vendor payout (Phase E) — one Stripe transfer to the vendor's connected
 * account, covering one delivered order (`per_order` cadence) or a day's
 * worth of delivered orders (`daily_batch`). Always created post-delivery
 * (critical rule #4). The order ids + amounts are the statement data.
 */
export const vendorPayoutSchema = baseDocumentSchema.extend({
  vendorId: objectIdSchema,
  /** Sweep grouping key — the local delivery date (YYYY-MM-DD) for batches,
   * or the single order's date for per-order payouts. */
  period: z.string(),
  cadence: z.enum(["per_order", "daily_batch"]),
  /** Orders covered by this transfer (the statement line items). */
  orderIds: z.array(objectIdSchema),
  grossSen: moneySenSchema,
  commissionSen: moneySenSchema,
  netSen: moneySenSchema,
  status: payoutStatusSchema,
  stripeTransferId: z.string().optional(),
  /** Connected account the transfer was sent to (snapshot for the statement). */
  stripeConnectAccountId: z.string().optional(),
  failureReason: z.string().optional(),
});
export type VendorPayout = z.infer<typeof vendorPayoutSchema>;
