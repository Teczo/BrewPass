import { NextResponse } from "next/server";

import { getCourierAdapter } from "@/lib/courier";
import { applyCourierWebhookEvent } from "@/lib/courier/service";
import { courierProviderSchema } from "@/lib/models";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ provider: string }> };

/**
 * Courier delivery webhook (v2.1, critical rule #6) — the money-gating signal.
 * The courier's verified, idempotent status webhook (not a human button)
 * confirms delivery and releases payout. Handled exactly like the Stripe
 * webhook: verify the signature first, then process idempotently and tolerate
 * retries/out-of-order events. The endpoint stays reliable (providers disable
 * URLs that fail repeatedly) by always returning 2xx for events it can't act
 * on, and 5xx only for genuine processing failures it wants retried.
 */
export async function POST(request: Request, context: RouteContext) {
  const { provider: providerParam } = await context.params;
  const parsedProvider = courierProviderSchema.safeParse(providerParam);
  if (!parsedProvider.success || parsedProvider.data === "manual") {
    return NextResponse.json({ error: "Unknown courier provider" }, { status: 404 });
  }
  const provider = parsedProvider.data;

  const adapter = getCourierAdapter(provider);
  if (!adapter) {
    return NextResponse.json({ error: "Provider not enabled" }, { status: 404 });
  }

  const rawBody = await request.text();
  if (!adapter.verifyWebhook(rawBody, request.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = adapter.parseWebhook(rawBody);
  if (!event) {
    // Verified but unparseable / no order ref — ack so the provider stops
    // retrying a payload we can never act on.
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    const result = await applyCourierWebhookEvent(provider, event);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    console.error(`Courier webhook (${provider}/${event.courierOrderId}) failed:`, error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
