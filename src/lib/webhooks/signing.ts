import { createHmac, randomBytes } from "node:crypto";

import type { WebhookEventType, WebhookSubscription } from "@/lib/models";

/**
 * Pure helpers for outbound webhook delivery (Phase I.5). No I/O — unit
 * tested. The dispatcher (dispatch.ts) wraps these with the database and
 * network calls.
 */

/** A new random signing secret for a subscription (shown to the admin once). */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

/**
 * HMAC-SHA256 signature over `${timestamp}.${body}` (Stripe-style). The
 * timestamp is signed too, so a receiver can reject replays. Returned as the
 * value of the `X-BrewPass-Signature` header: `t=<ts>,v1=<hex>`.
 */
export function signWebhookBody(secret: string, timestampMs: number, body: string): string {
  const signature = createHmac("sha256", secret).update(`${timestampMs}.${body}`).digest("hex");
  return `t=${timestampMs},v1=${signature}`;
}

/** Whether a subscription should receive an event of this type: an empty
 * `eventTypes` filter means "all types". */
export function eventMatchesSubscription(
  subscription: Pick<WebhookSubscription, "eventTypes">,
  type: WebhookEventType,
): boolean {
  return subscription.eventTypes.length === 0 || subscription.eventTypes.includes(type);
}

/** Retry backoff (minutes) by attempt count already made. Capped tail is
 * reused once exhausted; `maxAttempts` (not this table) decides giving up. */
export const WEBHOOK_BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360] as const;
export const WEBHOOK_MAX_ATTEMPTS = 6;

/** When to next attempt a delivery, given how many attempts have been made. */
export function nextAttemptAt(attemptsMade: number, now: Date): Date {
  const index = Math.min(Math.max(attemptsMade, 0), WEBHOOK_BACKOFF_MINUTES.length - 1);
  return new Date(now.getTime() + WEBHOOK_BACKOFF_MINUTES[index] * 60_000);
}

export interface WebhookEnvelope {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: Record<string, unknown>;
}

/** Build the signed event envelope body. `eventId` is the stable idempotency
 * key for the logical event (e.g. `order.delivered:<orderExternalId>`). */
export function buildEnvelope(
  eventId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
  now: Date,
): WebhookEnvelope {
  return { id: eventId, type, createdAt: now.toISOString(), data };
}
