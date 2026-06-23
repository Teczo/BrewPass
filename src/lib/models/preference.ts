import { z } from "zod";

import {
  baseDocumentSchema,
  drinkSpecSchema,
  localTimeSchema,
  objectIdSchema,
  weekdaySchema,
} from "@/lib/models/shared";

export const deliveryScheduleSchema = z.object({
  /** ISO weekdays on which a coffee should be delivered (1 = Mon … 7 = Sun). */
  days: z.array(weekdaySchema).min(1),
  /** Desired delivery time in the user's local timezone (Asia/Kuala_Lumpur). */
  time: localTimeSchema,
});
export type DeliverySchedule = z.infer<typeof deliveryScheduleSchema>;

/**
 * Phase J.2 — preferences are keyed per (`userId`, `scope`). `scope` is the
 * literal `"personal"` for the member's own coffee, or a corporate
 * membership's id (hex) for that membership's office coffee. This lets one
 * user hold a personal preference AND a separate office preference per
 * company, with neither overriding the other (critical rule #16). The unique
 * index moves from `{ userId }` to `{ userId, scope }`.
 */
export const PERSONAL_PREFERENCE_SCOPE = "personal" as const;
export const preferenceScopeSchema = z.union([
  z.literal(PERSONAL_PREFERENCE_SCOPE),
  z.string().regex(/^[0-9a-f]{24}$/i),
]);
export type PreferenceScope = z.infer<typeof preferenceScopeSchema>;

export const preferenceSchema = baseDocumentSchema.extend({
  userId: objectIdSchema,
  /** `"personal"` or a corporateMembershipId (hex). See PreferenceScope. */
  scope: preferenceScopeSchema,
  defaultDrink: drinkSpecSchema,
  schedule: deliveryScheduleSchema,
  defaultLocationId: objectIdSchema,
  /**
   * Confirmed preferred vendor (critical rule #5 — only set after the user
   * reviews and confirms a manual pick or an AI recommendation). Routing
   * uses it when the vendor is available, else falls back to auto-routing.
   * Null/unset = always platform auto-route.
   */
  preferredVendorId: objectIdSchema.optional(),
  /** How the confirmed preferred vendor was chosen. */
  vendorSelectionMethod: z.enum(["manual", "ai"]).optional(),
});
export type Preference = z.infer<typeof preferenceSchema>;
