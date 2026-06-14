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

export const preferenceSchema = baseDocumentSchema.extend({
  userId: objectIdSchema,
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
