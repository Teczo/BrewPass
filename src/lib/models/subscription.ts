import { z } from "zod";

import { baseDocumentSchema, objectIdSchema } from "@/lib/models/shared";

export const subscriptionPlanSchema = z.enum([
  "lite",
  "weekday",
  "premium",
  "student",
  "corporate",
]);
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

/** Mirrors the Stripe subscription lifecycle, plus an app-level pause. */
export const subscriptionStatusSchema = z.enum([
  "incomplete",
  "trialing",
  "active",
  "paused",
  "past_due",
  "canceled",
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const subscriptionSchema = baseDocumentSchema.extend({
  userId: objectIdSchema,
  plan: subscriptionPlanSchema,
  stripeCustomerId: z.string().min(1),
  /** For card-on-file memberships this is a synthetic key
   * (`membership:<userId>`); for corporate it is the real Stripe
   * subscription id. Either way it is unique and indexes the document. */
  stripeSubscriptionId: z.string().min(1),
  /**
   * How the subscriber pays for coffee (Phase E):
   * - `card_on_file`: no upfront/recurring charge; each coffee is charged at
   *   its own cutoff (individual/student memberships).
   * - `subscription`: a recurring Stripe subscription prepays a monthly quota
   *   (corporate seats; legacy v1 plans before migration).
   * Unset is treated as `subscription` for backward compatibility.
   */
  billingMode: z.enum(["card_on_file", "subscription"]).optional(),
  status: subscriptionStatusSchema,
  /** Coffees included vs consumed in the current billing period. */
  quota: z.object({
    total: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
  }),
  currentPeriodStart: z.date(),
  currentPeriodEnd: z.date(),
  /** True when the user cancelled but keeps access until the period ends. */
  cancelAtPeriodEnd: z.boolean(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
