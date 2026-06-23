import { z } from "zod";

import { baseDocumentSchema } from "@/lib/models/shared";

/** `cafe` is the legacy v1 staff role; new vendor staff get `vendor`. */
export const userRoleSchema = z.enum([
  "individual",
  "corporate",
  "student",
  "admin",
  "cafe",
  "vendor",
]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userSchema = baseDocumentSchema.extend({
  /** Auth0 subject claim — the canonical identity link. */
  authSub: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).optional(),
  role: userRoleSchema,
  /** FCM device registration tokens for push notifications. */
  fcmTokens: z.array(z.string()),
  /** Set when the user finishes the onboarding flow (profile → locations → preferences). */
  onboardingCompletedAt: z.date().optional(),
  /** Stripe customer id, created lazily on first checkout. */
  stripeCustomerId: z.string().optional(),
  /**
   * Saved card (Phase E). Validated at signup via a SetupIntent and charged
   * per-day at each order's cutoff — never charged upfront (critical rule #3).
   * Mirrors the customer's default payment method.
   */
  defaultPaymentMethodId: z.string().optional(),
  /** Set by an admin after checking proof — unlocks the student plan. */
  studentVerifiedAt: z.date().optional(),
  /** Opt-in for caffeine/sugar insights (Phase 10). */
  healthOptInAt: z.date().optional(),
  /**
   * Phase J.5 — standing rule for same-day personal/office overlap. A member
   * may receive both a personal and an office coffee on one day (they bill to
   * different cards, so it is not a conflict). This is the member's optional
   * "remember my choice" so they are not asked on every overlap day:
   * `skip_personal` = on office-coffee days, skip my personal coffee;
   * `skip_office` = skip the office coffee instead. Unset/`keep_both` = keep
   * both (the default — the "user does nothing daily" promise, rule #17). Never
   * silently cancels either side beyond what this rule expresses.
   */
  overlapRule: z.enum(["keep_both", "skip_personal", "skip_office"]).optional(),
});
export type User = z.infer<typeof userSchema>;
