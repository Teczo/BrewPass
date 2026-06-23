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
  /**
   * Phase J.7 — the saved company card every delivered office coffee is
   * charged to (charge-then-deliver, rule #17). Validated via a SetupIntent;
   * never charged upfront. A member's personal card is never used for office
   * coffee and this card is never used for personal coffee.
   */
  companyStripePaymentMethodId: z.string().optional(),
  status: z.enum(["incomplete", "trialing", "active", "paused", "past_due", "canceled"]).optional(),
  currentPeriodStart: z.date().optional(),
  currentPeriodEnd: z.date().optional(),
  /** Phase J.2 — seed for members' office preferences. */
  officeDefaults: officeDefaultsSchema.optional(),
  /**
   * Phase J.3 — owner autonomy controls, enforced server-side on every member
   * order/preference mutation (critical rule #18). Optional in the schema;
   * unset is read as the confirmed defaults (individual / self-select on /
   * decline on) via the autonomy resolvers, so pre-J.3 accounts behave
   * correctly without a backfill.
   */
  selectionMode: z.enum(["bundle", "individual"]).optional(),
  memberSelfSelect: z.boolean().optional(),
  memberCanDecline: z.boolean().optional(),
  /** The single office coffee everyone gets when selectionMode = bundle.
   * Snapshotted at generation (rule #6); members never edit it. */
  bundleDrink: drinkSpecSchema.optional(),
});
export type CorporateAccount = z.infer<typeof corporateAccountSchema>;
