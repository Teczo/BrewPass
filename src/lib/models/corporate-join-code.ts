import { z } from "zod";

import { baseDocumentSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * Phase J.1 — join by code (no email management). The owner generates a
 * company join code that staff redeem from their own app to self-join, so the
 * owner never has to enter emails or know a member's login.
 *
 * - `reusable`: the company's standing code (rotatable). Optionally capped via
 *   `redemptionCap` so the owner can limit headcount; `null`/unset = uncapped.
 * - `single_use`: a tighter invite that exhausts after one redemption.
 *
 * Redeeming creates a `CorporateMembership` (`active`) — NOT a seat
 * subscription. There are no seats; office coffee is billed per delivery on
 * the company card (critical rule #17).
 */
export const corporateJoinCodeTypeSchema = z.enum(["reusable", "single_use"]);
export type CorporateJoinCodeType = z.infer<typeof corporateJoinCodeTypeSchema>;

export const corporateJoinCodeSchema = baseDocumentSchema.extend({
  /** Normalized, globally-unique redemption code (uppercase, ambiguity-free
   * charset). Looked up directly when a member redeems. */
  code: z.string().min(6).max(16),
  corporateAccountId: objectIdSchema,
  type: corporateJoinCodeTypeSchema,
  /** Owner-chosen join limit for a `reusable` code (uncapped when unset).
   * Ignored for `single_use`, which is implicitly capped at one. */
  redemptionCap: z.number().int().positive().optional(),
  redeemedCount: z.number().int().nonnegative(),
  /** Users who have redeemed this code (guards a double redemption). */
  redeemedBy: z.array(objectIdSchema),
  /** False once revoked or rotated out, or after a single-use code is spent. */
  active: z.boolean(),
  /** Set when a reusable code is rotated out by a newly-generated one. */
  rotatedAt: z.date().optional(),
});
export type CorporateJoinCode = z.infer<typeof corporateJoinCodeSchema>;
