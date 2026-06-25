import { z } from "zod";

import { objectIdSchema } from "@/lib/models/shared";

/**
 * Cached courier OAuth access token (Phase M). Uber Direct authenticates with
 * OAuth 2.0 client-credentials — a bearer token with a TTL. In serverless there
 * is no long-lived process to hold it, so the token is cached in Mongo (no new
 * infrastructure — rule #12) and refreshed on expiry before dispatch. A unique
 * index on `provider` keeps one row per courier. DoorDash Drive Classic signs
 * each request with a per-request JWT and needs no cached token.
 */
export const courierTokenSchema = z.object({
  _id: objectIdSchema,
  /** Owning provider (only OAuth couriers appear here, e.g. `uber_direct`). */
  provider: z.string().min(1),
  accessToken: z.string().min(1),
  /** Absolute expiry; the adapter refreshes shortly before this. */
  expiresAt: z.date(),
  updatedAt: z.date(),
});
export type CourierToken = z.infer<typeof courierTokenSchema>;
