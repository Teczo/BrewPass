import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { CourierProvider } from "@/lib/models";
import { mapLalamoveStatus } from "@/lib/courier/status";
import type {
  CourierAdapter,
  CourierContact,
  CourierDispatchResult,
  CourierDrinkMeta,
  CourierQuote,
  CourierStop,
  CourierTracking,
  CourierWebhookEvent,
} from "@/lib/courier/types";

/**
 * Lalamove v3 adapter (v2.1) — the first `CourierAdapter`. Talks to the REST
 * API directly with HMAC-signed `fetch`, matching the codebase's no-SDK
 * convention for third-party HTTP (Google Maps, Twilio, Resend). All Lalamove
 * specifics are sealed inside this file; nothing else imports it directly.
 *
 * Money is integer sen everywhere in BrewPass; Lalamove speaks decimal MYR
 * strings, so we convert only at this boundary.
 */

const DEFAULT_BASE_URL = "https://rest.sandbox.lalamove.com";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function baseUrl(): string {
  return env("LALAMOVE_BASE_URL") ?? DEFAULT_BASE_URL;
}

function market(): string {
  return env("LALAMOVE_MARKET") ?? "MY";
}

function serviceType(): string {
  return env("LALAMOVE_SERVICE_TYPE") ?? "MOTORCYCLE";
}

/** Webhook secret, falling back to the API secret (Lalamove signs with it). */
function webhookSecret(): string | undefined {
  return env("LALAMOVE_WEBHOOK_SECRET") ?? env("LALAMOVE_API_SECRET");
}

function senFromMyrString(total: string | number | undefined): number {
  const value = typeof total === "number" ? total : Number.parseFloat(total ?? "0");
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function coordNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

interface SignedRequest {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  /** Idempotency / trace id forwarded as Request-ID. */
  requestId?: string;
}

/**
 * Sign and send a Lalamove API request. Signature scheme (v3):
 *   raw = `${timestamp}\r\n${METHOD}\r\n${path}\r\n\r\n${body}`
 *   signature = HMAC-SHA256(apiSecret, raw)
 *   Authorization: `hmac ${apiKey}:${timestamp}:${signature}`
 */
async function signedFetch<T>({ method, path, body, requestId }: SignedRequest): Promise<T> {
  const apiKey = env("LALAMOVE_API_KEY");
  const apiSecret = env("LALAMOVE_API_SECRET");
  if (!apiKey || !apiSecret) {
    throw new Error("Lalamove is not configured (LALAMOVE_API_KEY / LALAMOVE_API_SECRET)");
  }

  const timestamp = Date.now().toString();
  const serializedBody = body === undefined ? "" : JSON.stringify(body);
  const raw = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${serializedBody}`;
  const signature = createHmac("sha256", apiSecret).update(raw).digest("hex");

  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `hmac ${apiKey}:${timestamp}:${signature}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Market: market(),
      "Request-ID": requestId ?? randomUUID(),
    },
    body: serializedBody === "" ? undefined : serializedBody,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Lalamove ${method} ${path} failed (${response.status}): ${text}`);
  }
  // DELETE returns no body.
  if (method === "DELETE") return undefined as T;
  return (await response.json()) as T;
}

function stopFor(stop: CourierStop) {
  return {
    coordinates: { lat: String(stop.lat), lng: String(stop.lng) },
    address: stop.address,
  };
}

export const lalamoveAdapter: CourierAdapter = {
  provider: "lalamove" as CourierProvider,

  isConfigured(): boolean {
    return Boolean(env("LALAMOVE_API_KEY") && env("LALAMOVE_API_SECRET"));
  },

  async getQuote(
    pickup: CourierStop,
    dropoff: CourierStop,
    drink: CourierDrinkMeta,
  ): Promise<CourierQuote> {
    const data = await signedFetch<{
      data: {
        quotationId: string;
        expiresAt?: string;
        priceBreakdown?: { total?: string };
        stops?: Array<{ stopId: string }>;
      };
    }>({
      method: "POST",
      path: "/v3/quotations",
      body: {
        data: {
          serviceType: serviceType(),
          language: "en_MY",
          stops: [stopFor(pickup), stopFor(dropoff)],
          item: {
            quantity: "1",
            weight: "LESS_THAN_3KG",
            categories: ["FOOD_DELIVERY"],
            handlingInstructions: [drink.description],
          },
        },
      },
    });

    const quote = data.data;
    const expiresAt = quote.expiresAt
      ? new Date(quote.expiresAt)
      : new Date(Date.now() + 5 * 60_000);
    return {
      quotationId: quote.quotationId,
      feeAmount: senFromMyrString(quote.priceBreakdown?.total),
      feeCurrency: "MYR",
      expiresAt,
      pickupStopId: quote.stops?.[0]?.stopId,
      dropoffStopId: quote.stops?.[1]?.stopId,
    };
  },

  async dispatch(
    quote: CourierQuote,
    _pickup: CourierStop,
    _dropoff: CourierStop,
    contacts: { sender: CourierContact; recipient: CourierContact },
    idempotencyKey: string,
  ): Promise<CourierDispatchResult> {
    const data = await signedFetch<{
      data: { orderId: string; shareLink?: string };
    }>({
      method: "POST",
      path: "/v3/orders",
      requestId: idempotencyKey,
      body: {
        data: {
          quotationId: quote.quotationId,
          sender: {
            stopId: quote.pickupStopId,
            name: contacts.sender.name,
            phone: contacts.sender.phone,
          },
          recipients: [
            {
              stopId: quote.dropoffStopId,
              name: contacts.recipient.name,
              phone: contacts.recipient.phone,
              remarks: contacts.recipient.remarks,
            },
          ],
          isPODEnabled: false,
        },
      },
    });
    return { courierOrderId: data.data.orderId, trackingUrl: data.data.shareLink ?? null };
  },

  async getTracking(courierOrderId: string): Promise<CourierTracking> {
    const order = await signedFetch<{
      data: { status: string; driverId?: string };
    }>({ method: "GET", path: `/v3/orders/${encodeURIComponent(courierOrderId)}` });

    let driver: CourierTracking["driver"] = null;
    let lat: number | null = null;
    let lng: number | null = null;

    if (order.data.driverId) {
      const driverRes = await signedFetch<{
        data: {
          name?: string;
          phone?: string;
          plateNumber?: string;
          coordinates?: { lat?: string; lng?: string };
        };
      }>({
        method: "GET",
        path: `/v3/orders/${encodeURIComponent(courierOrderId)}/drivers/${encodeURIComponent(order.data.driverId)}`,
      });
      driver = {
        name: driverRes.data.name ?? null,
        phone: driverRes.data.phone ?? null,
        plate: driverRes.data.plateNumber ?? null,
      };
      lat = coordNumber(driverRes.data.coordinates?.lat);
      lng = coordNumber(driverRes.data.coordinates?.lng);
    }

    return { status: order.data.status, driver, lat, lng };
  },

  async cancel(courierOrderId: string): Promise<void> {
    await signedFetch({
      method: "DELETE",
      path: `/v3/orders/${encodeURIComponent(courierOrderId)}`,
    });
  },

  /**
   * Verify an inbound webhook (critical rule #6). HMAC-SHA256 of the raw body
   * with the webhook secret, constant-time compared against the signature the
   * provider sends in the header. Fails closed when no secret is set — exactly
   * like the Stripe webhook. The exact header name may need to track Lalamove's
   * current spec; both common forms are accepted.
   */
  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const secret = webhookSecret();
    if (!secret) return false;

    const provided = headers.get("x-lalamove-signature") ?? headers.get("signature");
    if (!provided) return false;

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhook(rawBody: string): CourierWebhookEvent | null {
    let payload: {
      timestamp?: number | string;
      data?: {
        order?: { orderId?: string; status?: string };
        orderId?: string;
        status?: string;
        driver?: {
          name?: string;
          phone?: string;
          plateNumber?: string;
          location?: { lat?: string; lng?: string };
          coordinates?: { lat?: string; lng?: string };
        };
        updatedAt?: string;
      };
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const data = payload.data ?? {};
    const courierOrderId = data.order?.orderId ?? data.orderId;
    if (!courierOrderId) return null;

    const rawStatus = data.order?.status ?? data.status ?? null;
    const driverInfo = data.driver;
    const loc = driverInfo?.location ?? driverInfo?.coordinates;
    const eventAt =
      typeof payload.timestamp === "number"
        ? new Date(payload.timestamp)
        : data.updatedAt
          ? new Date(data.updatedAt)
          : new Date();

    return {
      courierOrderId,
      rawStatus,
      deliveryStatus: rawStatus ? mapLalamoveStatus(rawStatus) : null,
      eventAt,
      driver: driverInfo
        ? {
            name: driverInfo.name ?? null,
            phone: driverInfo.phone ?? null,
            plate: driverInfo.plateNumber ?? null,
          }
        : null,
      lat: coordNumber(loc?.lat),
      lng: coordNumber(loc?.lng),
    };
  },
};
