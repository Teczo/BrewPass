import { z } from "zod";

import {
  baseDocumentSchema,
  geoPointSchema,
  localTimeSchema,
  objectIdSchema,
  weekdaySchema,
} from "@/lib/models/shared";

/**
 * Vendor lifecycle. Application flow: `pending` → admin review →
 * `active` or `rejected` (a rejected applicant may re-apply). Operational
 * vendors move between `active`/`paused`/`offline` themselves; `suspended`
 * is admin-only.
 */
export const vendorStatusSchema = z.enum([
  "pending",
  "rejected",
  "active",
  "paused",
  "suspended",
  "offline",
]);
export type VendorStatus = z.infer<typeof vendorStatusSchema>;

/** One open window per ISO weekday (1 = Mon); a day with no entry is closed. */
export const operatingHoursSchema = z
  .array(
    z
      .object({
        day: weekdaySchema,
        open: localTimeSchema,
        close: localTimeSchema,
      })
      // HH:mm strings compare correctly lexicographically.
      .refine((win) => win.open < win.close, { message: "open must be before close" }),
  )
  .max(7)
  .refine((hours) => new Set(hours.map((win) => win.day)).size === hours.length, {
    message: "one window per day",
  });
export type OperatingHours = z.infer<typeof operatingHoursSchema>;

/**
 * A marketplace vendor. Absorbs the v1 Cafe — the platform's own coffee
 * operation is just Vendor #1, with no special-casing. Later phases extend
 * this document: taxonomy-mapped menus (C), Stripe Connect account (E),
 * commission override (E), daily/per-slot capacity caps (F), rating/SLA
 * metrics (G).
 */
export const vendorSchema = baseDocumentSchema.extend({
  businessName: z.string().min(1),
  /**
   * Owning user, set when a vendor applies through onboarding. Vendors
   * migrated from v1 (or admin-created) are platform-managed until claimed.
   */
  ownerUserId: objectIdSchema.optional(),
  status: vendorStatusSchema,
  address: z.string().min(1),
  geo: geoPointSchema,
  /**
   * Days/times the vendor accepts orders; unset = always open (v1-migrated
   * vendors). Routing consumes this in Phase D.
   */
  operatingHours: operatingHoursSchema.optional(),
  /**
   * Delivery service area: radius around `geo` in km. A polygon can
   * replace this later without breaking references.
   */
  serviceAreaRadiusKm: z.number().positive().max(100).optional(),
  /** Drinks/equipment the vendor can fulfil, e.g. "oat_milk", "cold_brew".
   * Superseded by taxonomy-mapped menus in Phase C. */
  capabilities: z.array(z.string()),
  /** Max orders the vendor can prepare per hour (v1 capacity model). */
  capacityPerHour: z.number().int().positive(),
  /** Auth0 subs of portal users: the owner plus admin-linked staff. */
  portalUserSubs: z.array(z.string()),
  /**
   * Max orders accepted per day, used by routing's capacity check. Unset =
   * uncapped (full per-slot capacity management arrives in Phase F).
   */
  dailyCapacity: z.number().int().positive().optional(),
  /**
   * Aggregate rating (1–5), the routing tiebreak. Unset until the vendor
   * has ratings (Phase G populates and maintains it).
   */
  ratingScore: z.number().min(0).max(5).optional(),
  /** Application/review trail (Phase B onboarding). */
  appliedAt: z.date().optional(),
  reviewedAt: z.date().optional(),
  /** Shown to the applicant when their application is rejected. */
  reviewNote: z.string().max(500).optional(),
});
export type Vendor = z.infer<typeof vendorSchema>;
