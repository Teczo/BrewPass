import { effectiveCommissionBps, splitOrderAmount } from "@/lib/payments/money";
import type { VendorStatus } from "@/lib/models";

/**
 * Phase K.1 — pure, unit-tested pack math and decisions. No DB or Stripe here;
 * the pack services add I/O around these. All money is integer sen.
 */

/**
 * Split `total` into `n` whole-sen parts that sum exactly to `total`. The
 * remainder is spread one sen at a time across the earliest parts, so nothing
 * is ever lost or created (the same invariant splitOrderAmount relies on).
 */
export function distributeEvenly(total: number, n: number): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`total must be a non-negative integer, got ${total}`);
  }
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`n must be a positive integer, got ${n}`);
  }
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

export interface PackSlotAmount {
  grossSen: number;
  commissionSen: number;
  vendorNetSen: number;
}

/**
 * Allocate a pack's gross (packPrice) and commission across the ASSIGNED slots
 * — the coffees actually made. The company pays the full pack price regardless
 * of how many slots are assigned (paid-for-and-skipped), but only assigned
 * coffees are delivery-gated payout units, so the vendor's net is shared among
 * them. Per-slot net = that slot's gross − its commission, so the slot totals
 * sum exactly to the pack's gross/commission/net.
 */
export function allocatePackAmounts(
  packPriceSen: number,
  commissionBps: number,
  assignedCount: number,
): PackSlotAmount[] {
  if (assignedCount <= 0) return [];
  // Validate inputs via the shared splitter (throws on bad gross/bps).
  splitOrderAmount(packPriceSen, commissionBps);
  const grossParts = distributeEvenly(packPriceSen, assignedCount);
  const totalCommission = splitOrderAmount(packPriceSen, commissionBps).commissionSen;
  const commissionParts = distributeEvenly(totalCommission, assignedCount);
  return grossParts.map((grossSen, i) => ({
    grossSen,
    commissionSen: commissionParts[i],
    vendorNetSen: grossSen - commissionParts[i],
  }));
}

/** The commission rate (bps) for a pack: the promo's own override when set,
 * else the vendor/platform rate (rule #11 — no promo rate is hardcoded). */
export function resolvePackCommissionBps(
  promoOverrideBps: number | null | undefined,
  vendorOrPlatformBps: number,
): number {
  return effectiveCommissionBps(vendorOrPlatformBps, promoOverrideBps);
}

export type AssignmentRefusal = "exceeds_pack_size" | "no_assignments";

/** Are these assignment counts valid for the pack? At least one coffee, and
 * never more than `packSize` (the count is locked). */
export function validateAssignmentCount(
  packSize: number,
  assignmentCount: number,
): { ok: true } | { ok: false; reason: AssignmentRefusal } {
  if (assignmentCount <= 0) return { ok: false, reason: "no_assignments" };
  if (assignmentCount > packSize) return { ok: false, reason: "exceeds_pack_size" };
  return { ok: true };
}

/** Whether a promotion is active and within its validity window on `localDate`
 * (inclusive). Used to decide if the admin may buy it for that day. */
export function isPromotionActiveOn(
  promo: { status: string; validFrom: string; validUntil: string },
  localDate: string,
): boolean {
  return promo.status === "active" && promo.validFrom <= localDate && localDate <= promo.validUntil;
}

/**
 * Whether a vendor can fulfil a vendor-pinned pack on `localDate`. A Pack does
 * NOT re-route (rule #20), so this is the gate that decides skip/refund vs
 * proceed at cutoff: the vendor must be operational and not sold out that day.
 */
export function vendorAvailableForPinnedPack(
  vendor: { status: VendorStatus; soldOutDates?: string[] },
  localDate: string,
): boolean {
  if (vendor.status !== "active") return false;
  if (vendor.soldOutDates?.includes(localDate)) return false;
  return true;
}
