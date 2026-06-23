import { z } from "zod";

import { deliveryScheduleSchema } from "@/lib/models/preference";
import { baseDocumentSchema, drinkSpecSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * Phase J.2 — office defaults seed each member's office preference (drink,
 * schedule, and the office delivery location). Set by the owner; a member's
 * office preference is created from these and can later be edited where the
 * owner's autonomy controls allow (Phase J.3).
 */
export const officeDefaultsSchema = z.object({
  drink: drinkSpecSchema,
  schedule: deliveryScheduleSchema,
  /** The office delivery location (a Location, typically the owner's). */
  locationId: objectIdSchema,
});
export type OfficeDefaults = z.infer<typeof officeDefaultsSchema>;

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
  /** Phase J.2 — seed for members' office preferences. */
  officeDefaults: officeDefaultsSchema.optional(),
});
export type CorporateAccount = z.infer<typeof corporateAccountSchema>;
