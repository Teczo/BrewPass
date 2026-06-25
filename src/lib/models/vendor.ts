import { z } from "zod";

import { courierProviderSchema, type CourierFeeCurrency } from "@/lib/models/delivery";
import {
  baseDocumentSchema,
  geoPointSchema,
  localDateSchema,
  localTimeSchema,
  objectIdSchema,
  weekdaySchema,
} from "@/lib/models/shared";

/**
 * The operating market a vendor belongs to (Phase M). Selects which courier
 * adapters and currency apply. `MY` (Malaysia, MYR) is the launch market;
 * `AU` (Australia / Perth, AUD) is added behind the same `CourierAdapter`
 * interface. Geocoded at onboarding to suggest a default; the admin sets it
 * authoritatively at approval (pre-filled from geocode, overridable).
 */
export const marketSchema = z.enum(["MY", "AU"]);
export type Market = z.infer<typeof marketSchema>;

/** The fee currency each market is billed in (Phase M). */
export const MARKET_CURRENCY: Record<Market, CourierFeeCurrency> = {
  MY: "MYR",
  AU: "AUD",
};

/**
 * Coarse geocode → market suggestion (Phase M). Australia is the only AU-market
 * territory and sits entirely in the southern hemisphere, so a negative
 * latitude is a reliable AU signal versus Malaysia's northern coordinates.
 * This only *suggests* a default at onboarding — the admin confirms/overrides
 * the authoritative `market` at approval, so the heuristic never needs to be
 * exhaustive.
 */
export function suggestMarketFromGeo(geo: { lat: number }): Market {
  return geo.lat < 0 ? "AU" : "MY";
}

/**
 * Optional per-hour delivery caps (Phase F). Each entry caps orders whose
 * delivery falls in that KL hour-of-day (0–23); hours without an entry are
 * limited only by the daily cap. Layered on top of `dailyCapacity`.
 */
export const slotCapacitySchema = z
  .array(
    z.object({
      hour: z.number().int().min(0).max(23),
      cap: z.number().int().nonnegative(),
    }),
  )
  .max(24)
  .refine((slots) => new Set(slots.map((s) => s.hour)).size === slots.length, {
    message: "one cap per hour",
  });
export type SlotCapacity = z.infer<typeof slotCapacitySchema>;

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
  /**
   * Operating market (Phase M) — selects the courier adapters and currency for
   * this vendor's handoffs. Geocoded default at onboarding, admin-authoritative
   * at approval. Existing vendors are backfilled to `MY` (Phase M migration).
   */
  market: marketSchema,
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
   * Per-hour delivery caps (Phase F). Layered under `dailyCapacity`: an order
   * is only assignable if both its delivery hour's cap and the daily cap have
   * room. Unset = hours limited only by the daily cap.
   */
  slotCapacities: slotCapacitySchema.optional(),
  /**
   * Local dates (YYYY-MM-DD) the vendor has marked "sold out" — routing skips
   * them for that day only. Past dates are pruned on write (Phase F).
   */
  soldOutDates: z.array(localDateSchema).optional(),
  /**
   * Per-vendor order-accepting cutoff (Phase F): a KL time-of-day after which
   * the vendor won't take an order *assigned* on the delivery day. Gates
   * same-day reassignment; night-before generation is always earlier so it is
   * unaffected. Unset = no extra cutoff (platform cutoff still applies).
   */
  orderAcceptCutoff: localTimeSchema.optional(),
  /**
   * Aggregate rating (1–5), part of the routing quality tiebreak. Unset until
   * the vendor has ratings (Phase G populates and maintains it from raw
   * counters below).
   */
  ratingScore: z.number().min(0).max(5).optional(),
  /**
   * Raw quality counters (Phase G). Derived rates (ratingScore,
   * acceptanceRate, onTimeRate) are recomputed from these on every quality
   * event, so the aggregates can always be rebuilt from the counters.
   */
  ratingSum: z.number().int().nonnegative().optional(),
  ratingCount: z.number().int().nonnegative().optional(),
  /** Implicit accepts (orders locked without a decline) vs declines. */
  acceptedCount: z.number().int().nonnegative().optional(),
  declinedCount: z.number().int().nonnegative().optional(),
  /** Deliveries and how many were on time (Phase G SLA). */
  deliveredCount: z.number().int().nonnegative().optional(),
  onTimeCount: z.number().int().nonnegative().optional(),
  /** Derived rates in [0,1]; unset until there is data. */
  acceptanceRate: z.number().min(0).max(1).optional(),
  onTimeRate: z.number().min(0).max(1).optional(),
  /**
   * Auto-suspension from routing for poor quality (Phase G "flag + suspend").
   * Set when metrics fall below threshold with enough samples; an admin
   * clears it. Routing skips quality-suspended vendors.
   */
  qualitySuspendedAt: z.date().optional(),
  qualityFlagReason: z.string().optional(),
  /** Application/review trail (Phase B onboarding). */
  appliedAt: z.date().optional(),
  reviewedAt: z.date().optional(),
  /** Shown to the applicant when their application is rejected. */
  reviewNote: z.string().max(500).optional(),
  /**
   * Stripe Connect (Phase E). The connected account holds the vendor's
   * bank/KYC — we never store payout details ourselves (critical rule #9).
   * Set on first onboarding; the enabled flags mirror the account's
   * charges/payouts capabilities from `account.updated` webhooks.
   */
  stripeConnectAccountId: z.string().optional(),
  connectChargesEnabled: z.boolean().optional(),
  connectPayoutsEnabled: z.boolean().optional(),
  /**
   * Per-vendor commission override in basis points (nullable → falls back to
   * the platform default). Admin-set in Phase H.
   */
  commissionRateOverrideBps: z.number().int().min(0).max(10_000).optional(),
  /**
   * How often delivered, held funds are swept to the vendor. Unset =
   * `daily_batch` (the default). Never gates *whether* payout happens — that
   * is always delivery-gated (critical rule #4).
   */
  payoutCadence: z.enum(["per_order", "daily_batch"]).optional(),
  /**
   * Courier provider override for this vendor's handoffs. Unset → the vendor's
   * market primary (Lalamove for MY, Uber Direct for AU) when available, with
   * AU auto-fallback; else `manual`. `manual` is for vendors who self-deliver.
   * Resolved by `resolveCourierProvider()` / `resolveCourierChain()`.
   */
  courierProvider: courierProviderSchema.optional(),
});
export type Vendor = z.infer<typeof vendorSchema>;
