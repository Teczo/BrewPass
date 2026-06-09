import { ObjectId } from "mongodb";
import { z } from "zod";

/** All money is stored in integer minor units (sen). */
export const CURRENCY = "MYR" as const;
export const moneySenSchema = z.number().int().nonnegative();

/** All timestamps are stored in UTC; convert to local time at the edges. */
export const DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur" as const;

export const objectIdSchema = z.instanceof(ObjectId);

/** Calendar date in the user's local timezone, formatted YYYY-MM-DD. */
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Time of day in the user's local timezone, formatted HH:mm (24h). */
export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm (24h)");

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const weekdaySchema = z.number().int().min(1).max(7);

export const baseDocumentSchema = z.object({
  _id: objectIdSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

/**
 * Drink specification. Used live in Preference and snapshotted onto Orders.
 * Option values are free-form strings for now; the catalogue of valid
 * drinks/options per café is a business decision settled in later phases.
 */
export const drinkSpecSchema = z.object({
  drink: z.string().min(1),
  size: z.enum(["small", "regular", "large"]),
  milk: z.string().min(1),
  /** Sugar level in steps, 0 = none. */
  sugar: z.number().int().min(0).max(5),
  strength: z.enum(["mild", "regular", "strong", "double"]),
  notes: z.string().optional(),
});
export type DrinkSpec = z.infer<typeof drinkSpecSchema>;
