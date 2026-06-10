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
  stripeSubscriptionId: z.string().min(1),
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
