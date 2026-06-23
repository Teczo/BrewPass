import { z } from "zod";

import { packModeSchema } from "@/lib/models/vendor-promotion";
import {
  baseDocumentSchema,
  drinkSpecSchema,
  localDateSchema,
  moneySenSchema,
  objectIdSchema,
} from "@/lib/models/shared";

/**
 * Phase K.1 — a team admin's purchase of a Vendor Pack for one day. The day's
 * office purchase = one optional PackPurchase (covering up to `packSize`
 * members) + N normally-routed top-up Orders for members beyond the pack.
 *
 * Charge-then-deliver (rule #3): the company card is charged the (snapshotted)
 * pack price ONCE at cutoff — paid-for-and-skipped slots included — and each
 * assigned coffee becomes its own vendor-pinned, delivery-gated Order for
 * payout (rule #4). The pack is vendor-pinned and opts out of taxonomy reroute
 * (rule #20): if the vendor is offline at cutoff the pack is skipped/refunded
 * and the admin notified, never silently re-routed.
 */
export const packAssignmentSchema = z.object({
  corporateMembershipId: objectIdSchema,
  /** The coffee for this slot — the fixed pack drink, or the buyer's choice. */
  drinkSpec: drinkSpecSchema,
});
export type PackAssignment = z.infer<typeof packAssignmentSchema>;

/** The pack terms frozen at purchase (critical rule #6) — never re-read live. */
export const packSnapshotSchema = z.object({
  vendorId: objectIdSchema,
  packSize: z.number().int().positive(),
  packPriceSen: moneySenSchema,
  packMode: packModeSchema,
  fixedDrink: drinkSpecSchema.optional(),
  /** Promo commission override snapshotted with the pack (nullable → fallback). */
  commissionRateOverrideBps: z.number().int().min(0).max(10_000).optional(),
});
export type PackSnapshot = z.infer<typeof packSnapshotSchema>;

export const packPurchaseStatusSchema = z.enum(["pending", "charged", "skipped", "failed"]);
export type PackPurchaseStatus = z.infer<typeof packPurchaseStatusSchema>;

export const packPurchaseSchema = baseDocumentSchema.extend({
  corporateAccountId: objectIdSchema,
  vendorPromotionId: objectIdSchema,
  /** The delivery date this pack covers (per-day purchase). */
  date: localDateSchema,
  packSnapshot: packSnapshotSchema,
  /** Members covered by the pack (length ≤ packSize). Unassigned slots are
   * paid-for-and-skipped. Editable until the date's cutoff. */
  assignments: z.array(packAssignmentSchema),
  /** Overflow members (beyond the pack) covered by individual top-up Orders,
   * which are normally routed (taxonomy-portable). */
  topUpMembershipIds: z.array(objectIdSchema),
  /** The top-up Orders linked to this purchase (resolved around cutoff). */
  topUpOrderIds: z.array(objectIdSchema),
  status: packPurchaseStatusSchema,
  /** The single company-card charge for the pack price. */
  chargeStatus: z.enum(["charged", "failed", "refunded"]).optional(),
  stripeChargeId: z.string().optional(),
  chargedAt: z.date().optional(),
  failureReason: z.string().optional(),
});
export type PackPurchase = z.infer<typeof packPurchaseSchema>;
