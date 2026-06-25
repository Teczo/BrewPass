import { createHmac, timingSafeEqual } from "node:crypto";

import { mapDoorDashDriveStatus } from "@/lib/courier/status";
import type {
  CourierAdapter,
  CourierDispatchResult,
  CourierQuote,
  CourierTracking,
  CourierWebhookEvent,
} from "@/lib/courier/types";
import type { CourierProvider } from "@/lib/models";

/**
 * DoorDash Drive Classic adapter (Phase M) — the AU-market *fallback*, behind
 * Uber Direct in `AU_FALLBACK_CHAIN`. **Dormant scaffold.** Production access is
 * allowlist-only and the AU sandbox must be enabled per-account by DoorDash
 * Support, who also confirm which API surface (Drive Classic vs standard Drive)
 * is granted — so the live request path is deliberately *not* built out yet
 * (see the Phase M go-live TODO). `isConfigured()` returns false until the
 * production env vars exist, so `resolveCourierChain()` never selects this
 * adapter and the network methods below stay unreachable.
 *
 * The pure pieces — status mapping (`status.ts`) and webhook verify/parse — are
 * wired now because they're cheap and let the existing `[provider]` webhook
 * route accept DoorDash events the moment access is granted. Field/event names
 * are marked TBC and must be confirmed against the granted surface (auth is
 * per-request JWT signing with the DoorDash signing secret — built when the
 * surface is confirmed).
 */

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

const NOT_BUILT =
  "DoorDash Drive Classic adapter is a dormant scaffold — confirm the granted " +
  "API surface with DoorDash Support and implement before enabling (Phase M).";

export const doordashDriveAdapter: CourierAdapter = {
  provider: "doordash_drive" as CourierProvider,

  /**
   * False until the production credentials are set. Gating here keeps the
   * adapter dormant in production (and out of the AU fallback chain) until
   * DoorDash grants access — the same posture as the reserved Grab adapter.
   */
  isConfigured(): boolean {
    return Boolean(
      env("DOORDASH_DRIVE_DEVELOPER_ID") &&
      env("DOORDASH_DRIVE_KEY_ID") &&
      env("DOORDASH_DRIVE_SIGNING_SECRET"),
    );
  },

  // The live request path is intentionally unbuilt — see the file header. These
  // satisfy the `CourierAdapter` shape and throw if ever reached (they can't be,
  // since `isConfigured()` keeps the adapter out of the dispatch chain). Params
  // are omitted because none are used yet; TS still accepts the narrower arity.
  async getQuote(): Promise<CourierQuote> {
    throw new Error(NOT_BUILT);
  },

  async dispatch(): Promise<CourierDispatchResult> {
    throw new Error(NOT_BUILT);
  },

  async getTracking(): Promise<CourierTracking> {
    throw new Error(NOT_BUILT);
  },

  async cancel(): Promise<void> {
    throw new Error(NOT_BUILT);
  },

  /**
   * Verify an inbound webhook (critical rule #6). HMAC-SHA256 of the raw body
   * with the webhook secret, hex digest in `X-DoorDash-Signature`. Fails closed
   * when no secret is set — so while dormant every DoorDash webhook is rejected.
   */
  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const secret = env("DOORDASH_DRIVE_WEBHOOK_SECRET");
    if (!secret) return false;

    const provided = headers.get("x-doordash-signature");
    if (!provided) return false;

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhook(rawBody: string): CourierWebhookEvent | null {
    // Field/event names are TBC against the granted Drive Classic surface.
    let payload: {
      external_delivery_id?: string;
      delivery_id?: string;
      id?: string;
      delivery_status?: string;
      status?: string;
      created_at?: string;
      dasher?: {
        name?: string;
        phone_number?: string;
        vehicle?: { type?: string };
        location?: { lat?: number; lng?: number };
      };
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const courierOrderId = payload.external_delivery_id ?? payload.delivery_id ?? payload.id;
    if (!courierOrderId) return null;

    const rawStatus = payload.delivery_status ?? payload.status ?? null;
    const dasher = payload.dasher;
    const loc = dasher?.location;
    return {
      courierOrderId,
      rawStatus,
      deliveryStatus: rawStatus ? mapDoorDashDriveStatus(rawStatus) : null,
      eventAt: payload.created_at ? new Date(payload.created_at) : new Date(),
      driver: dasher
        ? {
            name: dasher.name ?? null,
            phone: dasher.phone_number ?? null,
            plate: dasher.vehicle?.type ?? null,
          }
        : null,
      lat: num(loc?.lat),
      lng: num(loc?.lng),
    };
  },
};
