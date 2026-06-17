import { randomUUID } from "node:crypto";

import { ObjectId } from "mongodb";
import { z } from "zod";

/** All money is stored in integer minor units (sen). */
export const CURRENCY = "MYR" as const;
export const moneySenSchema = z.number().int().nonnegative();

/** All timestamps are stored in UTC; convert to local time at the edges. */
export const DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur" as const;

export const objectIdSchema = z.instanceof(ObjectId);

/**
 * Phase I.3 — reserved tenant/platform id. Every entity carries `tenantId`,
 * defaulted to this single constant. This is a schema reservation ONLY: no
 * multi-tenant isolation, routing, or per-tenant logic exists yet (critical
 * rule #14). Reserving the field now makes a future activation a config
 * change rather than a painful migration.
 */
export const DEFAULT_TENANT_ID = "brewpass" as const;

/** Stable external UUID (Phase I.2). Distinct from Mongo `_id`; this is what
 * the API boundary exposes, never the raw `_id` (critical rule #14). */
export const externalIdSchema = z.string().uuid();
export const tenantIdSchema = z.string().min(1);

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
  /** Stable external identity (Phase I.2), generated on create. */
  externalId: externalIdSchema,
  /** Reserved tenant id (Phase I.3), defaulted to DEFAULT_TENANT_ID. */
  tenantId: tenantIdSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Identity/reservation fields stamped on every new document (Phase I.2/I.3).
 * Spread into the doc (or into `$setOnInsert` on an upsert) at create time so
 * `externalId` is generated exactly once and `tenantId` is always set to the
 * default constant. Generating here — rather than per call site — keeps the
 * "always on create" guarantee (critical rule #14) in one place.
 */
export function newDocumentMeta(): { externalId: string; tenantId: string } {
  return { externalId: randomUUID(), tenantId: DEFAULT_TENANT_ID };
}

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
  drink: z.string().min(1).max(80),
  size: z.enum(["small", "regular", "large"]),
  milk: z.string().min(1).max(40),
  /** Sugar level in steps, 0 = none. */
  sugar: z.number().int().min(0).max(5),
  strength: z.enum(["mild", "regular", "strong", "double"]),
  notes: z.string().max(300).optional(),
});
export type DrinkSpec = z.infer<typeof drinkSpecSchema>;
