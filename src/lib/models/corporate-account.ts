import { z } from "zod";

import { baseDocumentSchema, objectIdSchema } from "@/lib/models/shared";

export const corporateAccountSchema = baseDocumentSchema.extend({
  company: z.string().min(1),
  billingOwnerUserId: objectIdSchema,
  memberUserIds: z.array(objectIdSchema),
  seatCount: z.number().int().positive(),
  /** One Stripe subscription on the billing owner, quantity = seatCount. */
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  status: z.enum(["incomplete", "trialing", "active", "paused", "past_due", "canceled"]).optional(),
  currentPeriodStart: z.date().optional(),
  currentPeriodEnd: z.date().optional(),
});
export type CorporateAccount = z.infer<typeof corporateAccountSchema>;
