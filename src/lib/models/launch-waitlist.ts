import { z } from "zod";

import { marketSchema } from "@/lib/models/vendor";
import { baseDocumentSchema, geoPointSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * Cold-start launch waitlist (Phase O.1, `fallbacks.md` §1.1/§1.2).
 *
 * When a subscriber completes onboarding but **no vendor's service area covers
 * their address at all** — a true coverage gap, not a transient all-busy day —
 * order generation skips them silently and records them here instead of pushing
 * a failure. When a vendor is later approved `active`, a one-shot job matches
 * their service area against this list and emails matched users once.
 *
 * One record per user (unique on `userId`); the upsert preserves `notifiedAt`
 * so a re-run of generation never clears a fulfilled entry. `notifiedAt` set =
 * coverage arrived and the user was emailed — the entry is fulfilled and never
 * matched again (so a user is never emailed twice, `fallbacks.md` §1.2).
 */
export const launchWaitlistSchema = baseDocumentSchema.extend({
  userId: objectIdSchema,
  /** The address text the user entered (their default delivery location). */
  address: z.string().min(1),
  /** Geocoded delivery point — matched against a new vendor's service area. */
  geo: geoPointSchema,
  /** Market suggested from the geo, so matching only considers same-market vendors. */
  market: marketSchema,
  /** Set once coverage arrives and the user has been emailed; fulfilled thereafter. */
  notifiedAt: z.date().optional(),
  /** The vendor whose approval first covered this user (audit trail). */
  notifiedByVendorId: objectIdSchema.optional(),
});
export type LaunchWaitlist = z.infer<typeof launchWaitlistSchema>;
