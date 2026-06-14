import type { ObjectId } from "mongodb";

/**
 * Pure money math for Phase E — deterministic and unit-tested. All amounts
 * are integer sen (MYR); commission rates are integer basis points
 * (1% = 100 bps, so 20% = 2000 bps) to keep everything in integers and avoid
 * floating-point drift on money (v1 convention).
 *
 * The platform charges the subscriber the order's gross price into the
 * platform balance at cutoff, retains commission, and transfers the vendor's
 * net to their connected account only after delivery (critical rule #4 —
 * delivery-gated payouts, separate charges and transfers).
 */

/** Platform default commission: 20% (confirmed 2026-06-14). Per-vendor
 * overrides live on Vendor.commissionRateOverrideBps; an admin can change the
 * platform default via CommissionConfig. */
export const PLATFORM_DEFAULT_COMMISSION_BPS = 2000;

export const BPS_DENOMINATOR = 10_000;

/** Resolve the commission rate for a vendor: their override when set, else
 * the platform default. */
export function effectiveCommissionBps(
  platformDefaultBps: number,
  vendorOverrideBps?: number | null,
): number {
  return vendorOverrideBps ?? platformDefaultBps;
}

export interface MoneySplit {
  grossSen: number;
  commissionSen: number;
  vendorNetSen: number;
  commissionBps: number;
}

/**
 * Split an order's gross into platform commission and vendor net. Commission
 * rounds down, so the rounding remainder always favours the vendor and
 * commission + net is exactly gross (never over-charges, never loses a sen).
 */
export function splitOrderAmount(grossSen: number, commissionBps: number): MoneySplit {
  if (!Number.isInteger(grossSen) || grossSen < 0) {
    throw new Error(`grossSen must be a non-negative integer, got ${grossSen}`);
  }
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > BPS_DENOMINATOR) {
    throw new Error(
      `commissionBps must be an integer in [0, ${BPS_DENOMINATOR}], got ${commissionBps}`,
    );
  }
  const commissionSen = Math.floor((grossSen * commissionBps) / BPS_DENOMINATOR);
  return {
    grossSen,
    commissionSen,
    vendorNetSen: grossSen - commissionSen,
    commissionBps,
  };
}

export interface PayoutLine {
  orderId: ObjectId;
  grossSen: number;
  commissionSen: number;
  vendorNetSen: number;
}

export interface PayoutBatch {
  orderIds: ObjectId[];
  grossSen: number;
  commissionSen: number;
  netSen: number;
}

/**
 * Aggregate per-order splits into a single batch total (a daily_batch sweep,
 * or a one-line per_order payout). Net is summed from each line's net so the
 * batch transfer exactly equals what each delivered order earned.
 */
export function buildPayoutBatch(lines: PayoutLine[]): PayoutBatch {
  return lines.reduce<PayoutBatch>(
    (batch, line) => {
      batch.orderIds.push(line.orderId);
      batch.grossSen += line.grossSen;
      batch.commissionSen += line.commissionSen;
      batch.netSen += line.vendorNetSen;
      return batch;
    },
    { orderIds: [], grossSen: 0, commissionSen: 0, netSen: 0 },
  );
}
