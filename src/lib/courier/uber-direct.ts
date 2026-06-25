import { createHmac, timingSafeEqual } from "node:crypto";

import { ObjectId } from "mongodb";

import { courierTokensCollection } from "@/lib/collections";
import { mapUberDirectStatus } from "@/lib/courier/status";
import type {
  CourierAdapter,
  CourierContact,
  CourierDispatchResult,
  CourierQuote,
  CourierStop,
  CourierTracking,
  CourierWebhookEvent,
} from "@/lib/courier/types";
import type { CourierProvider } from "@/lib/models";

/**
 * Uber Direct adapter (Phase M) — the AU-market primary `CourierAdapter`. Talks
 * to the Uber Direct REST API directly with `fetch`, matching the no-SDK
 * convention. Everything Uber-specific (OAuth, address shape, status names,
 * webhook signature header) is sealed in this file; the fallback to DoorDash
 * lives in `courier/index.ts`, never here (critical rule #23).
 *
 * Auth is OAuth 2.0 client-credentials: a bearer token with a TTL, cached in
 * Mongo (`courierTokens`) so serverless invocations share it and refresh only
 * on expiry. Uber speaks integer minor units already (cents), so — unlike
 * Lalamove's decimal MYR — there is no money conversion at this boundary.
 */

const DEFAULT_BASE_URL = "https://api.uber.com";
const DEFAULT_AUTH_URL = "https://login.uber.com/oauth/v2/token";
/** Refresh a little before expiry so a token never dies mid-dispatch. */
const TOKEN_SKEW_MS = 60_000;

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function baseUrl(): string {
  return env("UBER_DIRECT_BASE_URL") ?? DEFAULT_BASE_URL;
}

function authUrl(): string {
  return env("UBER_DIRECT_AUTH_URL") ?? DEFAULT_AUTH_URL;
}

function customerId(): string {
  const id = env("UBER_DIRECT_CUSTOMER_ID");
  if (!id) throw new Error("Uber Direct is not configured (UBER_DIRECT_CUSTOMER_ID)");
  return id;
}

function customerPath(suffix: string): string {
  return `/v1/customers/${encodeURIComponent(customerId())}${suffix}`;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * A live access token, from the Mongo cache when still valid or freshly minted
 * via the client-credentials grant. The cache is keyed `uber_direct` (one row),
 * upserted on refresh. Concurrent refreshes are harmless — both tokens are
 * valid and last-write-wins.
 */
async function getAccessToken(): Promise<string> {
  const clientId = env("UBER_DIRECT_CLIENT_ID");
  const clientSecret = env("UBER_DIRECT_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Uber Direct is not configured (UBER_DIRECT_CLIENT_ID / _SECRET)");
  }

  const tokens = await courierTokensCollection();
  const now = Date.now();
  const cached = await tokens.findOne({ provider: "uber_direct" });
  if (cached && cached.expiresAt.getTime() - TOKEN_SKEW_MS > now) {
    return cached.accessToken;
  }

  const response = await fetch(authUrl(), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "eats.deliveries",
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Uber Direct auth failed (${response.status}): ${text}`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  const expiresAt = new Date(now + data.expires_in * 1000);

  await tokens.updateOne(
    { provider: "uber_direct" },
    {
      $set: { accessToken: data.access_token, expiresAt, updatedAt: new Date(now) },
      $setOnInsert: { _id: new ObjectId(), provider: "uber_direct" },
    },
    { upsert: true },
  );
  return data.access_token;
}

interface ApiRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** Forwarded as the Uber `Idempotency-Key` header on writes. */
  idempotencyKey?: string;
}

async function api<T>({ method, path, body, idempotencyKey }: ApiRequest): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    cache: "no-store",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Uber Direct ${method} ${path} failed (${response.status}): ${text}`);
  }
  return (await response.json()) as T;
}

/** Uber accepts a single-line formatted address string for quote/create. */
function addressLine(stop: CourierStop): string {
  return stop.address;
}

function feeCurrencyOf(raw: string | undefined): CourierQuote["feeCurrency"] {
  return (raw ?? "").toUpperCase() === "MYR" ? "MYR" : "AUD";
}

export const uberDirectAdapter: CourierAdapter = {
  provider: "uber_direct" as CourierProvider,

  isConfigured(): boolean {
    return Boolean(
      env("UBER_DIRECT_CLIENT_ID") &&
      env("UBER_DIRECT_CLIENT_SECRET") &&
      env("UBER_DIRECT_CUSTOMER_ID"),
    );
  },

  async getQuote(pickup: CourierStop, dropoff: CourierStop): Promise<CourierQuote> {
    const data = await api<{
      id: string;
      fee?: number;
      currency?: string;
      currency_code?: string;
      expires?: string;
    }>({
      method: "POST",
      path: customerPath("/delivery_quotes"),
      body: {
        pickup_address: addressLine(pickup),
        pickup_latitude: pickup.lat,
        pickup_longitude: pickup.lng,
        dropoff_address: addressLine(dropoff),
        dropoff_latitude: dropoff.lat,
        dropoff_longitude: dropoff.lng,
      },
    });

    return {
      quotationId: data.id,
      feeAmount: num(data.fee) ?? 0,
      feeCurrency: feeCurrencyOf(data.currency ?? data.currency_code),
      expiresAt: data.expires ? new Date(data.expires) : new Date(Date.now() + 5 * 60_000),
    };
  },

  async dispatch(
    quote: CourierQuote,
    pickup: CourierStop,
    dropoff: CourierStop,
    contacts: { sender: CourierContact; recipient: CourierContact },
    idempotencyKey: string,
  ): Promise<CourierDispatchResult> {
    const data = await api<{ id: string; tracking_url?: string }>({
      method: "POST",
      path: customerPath("/deliveries"),
      idempotencyKey,
      body: {
        quote_id: quote.quotationId,
        pickup_name: contacts.sender.name,
        pickup_address: addressLine(pickup),
        pickup_phone_number: contacts.sender.phone,
        pickup_latitude: pickup.lat,
        pickup_longitude: pickup.lng,
        dropoff_name: contacts.recipient.name,
        dropoff_address: addressLine(dropoff),
        dropoff_phone_number: contacts.recipient.phone,
        dropoff_latitude: dropoff.lat,
        dropoff_longitude: dropoff.lng,
        dropoff_notes: contacts.recipient.remarks,
        manifest_items: [{ name: "Coffee", quantity: 1 }],
      },
    });
    return { courierOrderId: data.id, trackingUrl: data.tracking_url ?? null };
  },

  async getTracking(courierOrderId: string): Promise<CourierTracking> {
    const data = await api<{
      status: string;
      courier?: {
        name?: string;
        phone_number?: string;
        vehicle_type?: string;
        location?: { lat?: number; lng?: number };
      };
    }>({
      method: "GET",
      path: customerPath(`/deliveries/${encodeURIComponent(courierOrderId)}`),
    });

    const courier = data.courier;
    return {
      status: data.status,
      driver: courier
        ? {
            name: courier.name ?? null,
            phone: courier.phone_number ?? null,
            plate: courier.vehicle_type ?? null,
          }
        : null,
      lat: num(courier?.location?.lat),
      lng: num(courier?.location?.lng),
    };
  },

  async cancel(courierOrderId: string): Promise<void> {
    await api({
      method: "POST",
      path: customerPath(`/deliveries/${encodeURIComponent(courierOrderId)}/cancel`),
    });
  },

  /**
   * Verify an inbound webhook (critical rule #6 / #23). Uber signs the raw body
   * with HMAC-SHA256 and sends the hex digest in `X-Postmates-Signature`.
   * Constant-time compared; fails closed when no secret is set, like Stripe.
   */
  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const secret = env("UBER_DIRECT_WEBHOOK_SECRET");
    if (!secret) return false;

    const provided = headers.get("x-postmates-signature");
    if (!provided) return false;

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhook(rawBody: string): CourierWebhookEvent | null {
    let payload: {
      kind?: string;
      delivery_id?: string;
      id?: string;
      status?: string;
      created?: string | number;
      data?: {
        id?: string;
        status?: string;
        courier?: {
          name?: string;
          phone_number?: string;
          vehicle_type?: string;
          location?: { lat?: number; lng?: number };
        };
      };
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const data = payload.data ?? {};
    const courierOrderId = payload.delivery_id ?? data.id ?? payload.id;
    if (!courierOrderId) return null;

    const rawStatus = payload.status ?? data.status ?? null;
    const courier = data.courier;
    const loc = courier?.location;
    const eventAt =
      typeof payload.created === "number"
        ? new Date(payload.created)
        : typeof payload.created === "string"
          ? new Date(payload.created)
          : new Date();

    return {
      courierOrderId,
      rawStatus,
      deliveryStatus: rawStatus ? mapUberDirectStatus(rawStatus) : null,
      eventAt,
      driver: courier
        ? {
            name: courier.name ?? null,
            phone: courier.phone_number ?? null,
            plate: courier.vehicle_type ?? null,
          }
        : null,
      lat: num(loc?.lat),
      lng: num(loc?.lng),
    };
  },
};
