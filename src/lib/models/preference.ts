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
});
export type Preference = z.infer<typeof preferenceSchema>;
