import { z } from "zod";

import { baseDocumentSchema, geoPointSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * Vendor lifecycle. v1 cafés migrate as `active`/`paused` (was
 * `active: true/false`); `pending` is the Phase B application state and
 * `suspended`/`offline` are admin/vendor controls from Phases B+.
 */
export const vendorStatusSchema = z.enum(["pending", "active", "paused", "suspended", "offline"]);
export type VendorStatus = z.infer<typeof vendorStatusSchema>;

/**
 * A marketplace vendor. Absorbs the v1 Cafe — the platform's own coffee
 * operation is just Vendor #1, with no special-casing. Later phases extend
 * this document: operating hours + service area (B), taxonomy-mapped menus
 * (C), Stripe Connect account (E), commission override (E), daily/per-slot
 * capacity caps (F), rating/SLA metrics (G).
 */
export const vendorSchema = baseDocumentSchema.extend({
  businessName: z.string().min(1),
  /**
   * Owning user, set when a vendor applies through Phase B onboarding.
   * Vendors migrated from v1 are platform-managed until then.
   */
  ownerUserId: objectIdSchema.optional(),
  status: vendorStatusSchema,
  address: z.string().min(1),
  geo: geoPointSchema,
  /** Drinks/equipment the vendor can fulfil, e.g. "oat_milk", "cold_brew".
   * Superseded by taxonomy-mapped menus in Phase C. */
  capabilities: z.array(z.string()),
  /** Max orders the vendor can prepare per hour (v1 capacity model). */
  capacityPerHour: z.number().int().positive(),
  /** Auth0 subs of portal users (the dedicated vendor role lands in Phase B). */
  portalUserSubs: z.array(z.string()),
});
export type Vendor = z.infer<typeof vendorSchema>;
