import { z } from "zod";

import {
  baseDocumentSchema,
  drinkSpecSchema,
  localDateSchema,
  objectIdSchema,
  weekdaySchema,
} from "@/lib/models/shared";

/**
 * Append-only log of what the user actually drank and in what context.
 * Written on every confirmed order (from Phase 3) and consumed by the
 * Phase 8 recommendation engine. Never updated or deleted.
 */
export const preferenceSignalSchema = baseDocumentSchema.extend({
  userId: objectIdSchema,
  orderId: objectIdSchema,
  date: localDateSchema,
  context: z.object({
    weekday: weekdaySchema,
    /** e.g. "rain", "clear" — populated once the weather API lands (Phase 8b). */
    weather: z.string().optional(),
    locationLabel: z.string().optional(),
  }),
  chosenDrink: drinkSpecSchema,
  /** True if the user modified the auto-generated suggestion. */
  userModified: z.boolean(),
});
export type PreferenceSignal = z.infer<typeof preferenceSignalSchema>;
