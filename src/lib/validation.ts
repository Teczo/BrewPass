import { z } from "zod";

import { drinkSpecSchema, localTimeSchema, weekdaySchema } from "@/lib/models";

/**
 * Input schemas for API routes. These validate client-supplied payloads —
 * never trust the client; ids and server-derived fields (userId, geocodes,
 * timestamps) are filled in server-side.
 */

/** Roles a user may pick for themselves. `admin` is assigned manually, never self-served. */
export const selfServeRoleSchema = z.enum(["individual", "corporate", "student"]);

export const profileInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{6,18}$/, "expected a phone number like +60123456789"),
  role: selfServeRoleSchema,
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const locationInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().min(5).max(500),
  notes: z.string().trim().max(500).optional(),
});
export type LocationInput = z.infer<typeof locationInputSchema>;

const objectIdStringSchema = z.string().regex(/^[0-9a-f]{24}$/i, "expected an ObjectId");

/**
 * Order modification window actions. The server enforces status + cutoff;
 * this only shapes the payload.
 */
export const orderActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("unskip") }),
  z
    .object({
      action: z.literal("modify"),
      drink: drinkSpecSchema.optional(),
      locationId: objectIdStringSchema.optional(),
    })
    .refine((value) => value.drink !== undefined || value.locationId !== undefined, {
      message: "modify requires drink and/or locationId",
    }),
]);
export type OrderActionInput = z.infer<typeof orderActionSchema>;

export const preferenceInputSchema = z.object({
  defaultDrink: drinkSpecSchema,
  schedule: z.object({
    days: z.array(weekdaySchema).min(1).max(7),
    time: localTimeSchema,
  }),
  /** Must reference one of the user's own locations — verified server-side. */
  defaultLocationId: z.string().regex(/^[0-9a-f]{24}$/i, "expected an ObjectId"),
});
export type PreferenceInput = z.infer<typeof preferenceInputSchema>;
