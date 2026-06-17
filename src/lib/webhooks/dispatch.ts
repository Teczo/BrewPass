import { ObjectId } from "mongodb";

import { webhookDeliveriesCollection, webhookSubscriptionsCollection } from "@/lib/collections";
import type { WebhookDelivery, WebhookEventType, WebhookSubscription } from "@/lib/models";
import { newDocumentMeta } from "@/lib/models";
import {
  buildEnvelope,
  eventMatchesSubscription,
  nextAttemptAt,
  signWebhookBody,
  WEBHOOK_MAX_ATTEMPTS,
} from "@/lib/webhooks/signing";

/**
 * Outbound webhook dispatcher (Phase I.5). Two halves:
 *  - `emitEvent` runs inside core flows. It only *enqueues* a delivery row
 *    per matching subscription (a fast, idempotent DB upsert) and never makes
 *    an outbound request, so it can never block or slow a core action. It is
 *    also fully wrapped — an emission failure is logged, never thrown
 *    (critical rule #13, same contract as notifications).
 *  - `processWebhookRetries` runs from the cron and does the actual signed
 *    HTTP delivery with exponential backoff, driving each row to a terminal
 *    `delivered`/`failed`.
 */

const DELIVERY_TIMEOUT_MS = 10_000;
const LEASE_MS = 60_000;

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

/**
 * Enqueue an event for every active, matching subscription. Best-effort and
 * non-blocking: returns the number of deliveries enqueued and swallows all
 * errors. `eventId` is the stable idempotency key — re-emitting the same
 * logical event is a no-op per subscription (unique (subscriptionId, eventId)).
 */
export async function emitEvent(
  eventId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
  now: Date = new Date(),
): Promise<number> {
  try {
    const subscriptions = await webhookSubscriptionsCollection();
    const active = await subscriptions.find({ active: true }).toArray();
    const matching = active.filter((sub) => eventMatchesSubscription(sub, type));
    if (matching.length === 0) return 0;

    const envelope = buildEnvelope(eventId, type, data, now);
    const deliveries = await webhookDeliveriesCollection();

    let enqueued = 0;
    for (const sub of matching) {
      try {
        await deliveries.updateOne(
          { subscriptionId: sub._id, eventId },
          {
            $setOnInsert: {
              _id: new ObjectId(),
              ...newDocumentMeta(),
              subscriptionId: sub._id,
              eventId,
              eventType: type,
              url: sub.url,
              payload: envelope as unknown as Record<string, unknown>,
              status: "pending" as const,
              attempts: 0,
              maxAttempts: WEBHOOK_MAX_ATTEMPTS,
              nextAttemptAt: now,
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true },
        );
        enqueued += 1;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        // Already enqueued for this subscription — idempotent no-op.
      }
    }
    return enqueued;
  } catch (error) {
    // Emission must never break a core action (critical rule #13).
    console.error(`Webhook emit failed for ${type} (${eventId}):`, error);
    return 0;
  }
}

/** POST a single delivery's stored envelope, signed with the subscription
 * secret. Returns the HTTP status text or throws on network/timeout error. */
async function postDelivery(
  delivery: WebhookDelivery,
  secret: string,
  now: Date,
): Promise<{ ok: boolean; detail: string }> {
  const body = JSON.stringify(delivery.payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(delivery.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BrewPass-Event-Id": delivery.eventId,
        "X-BrewPass-Event-Type": delivery.eventType,
        "X-BrewPass-Signature": signWebhookBody(secret, now.getTime(), body),
      },
      body,
      signal: controller.signal,
    });
    return { ok: response.ok, detail: `HTTP ${response.status}` };
  } finally {
    clearTimeout(timer);
  }
}

export interface WebhookRetrySummary {
  claimed: number;
  delivered: number;
  retrying: number;
  failed: number;
}

/**
 * Deliver every due pending delivery (status `pending`, `nextAttemptAt` past),
 * retrying with exponential backoff. A row leases itself forward before the
 * attempt so concurrent cron runs don't double-send the same one. On success
 * → `delivered`; on failure → back to `pending` with a later `nextAttemptAt`,
 * or `failed` once `maxAttempts` is reached.
 */
export async function processWebhookRetries(
  now: Date = new Date(),
  limit = 200,
): Promise<WebhookRetrySummary> {
  const deliveries = await webhookDeliveriesCollection();
  const subscriptions = await webhookSubscriptionsCollection();
  const summary: WebhookRetrySummary = { claimed: 0, delivered: 0, retrying: 0, failed: 0 };

  const secretCache = new Map<string, WebhookSubscription | null>();
  const loadSubscription = async (id: ObjectId): Promise<WebhookSubscription | null> => {
    const key = id.toHexString();
    if (!secretCache.has(key)) secretCache.set(key, await subscriptions.findOne({ _id: id }));
    return secretCache.get(key) ?? null;
  };

  for (let processed = 0; processed < limit; processed += 1) {
    // Claim one due delivery by leasing its nextAttemptAt forward.
    const delivery = await deliveries.findOneAndUpdate(
      { status: "pending", nextAttemptAt: { $lte: now } },
      { $set: { nextAttemptAt: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now } },
      { returnDocument: "after", sort: { nextAttemptAt: 1 } },
    );
    if (!delivery) break;
    summary.claimed += 1;

    const subscription = await loadSubscription(delivery.subscriptionId);
    const attemptsMade = delivery.attempts + 1;

    let ok = false;
    let detail = "subscription_missing_or_inactive";
    if (subscription && subscription.active) {
      try {
        const result = await postDelivery(delivery, subscription.secret, now);
        ok = result.ok;
        detail = result.detail;
      } catch (error) {
        detail = error instanceof Error ? error.message : "delivery_error";
      }
    }

    if (ok) {
      await deliveries.updateOne(
        { _id: delivery._id },
        {
          $set: {
            status: "delivered" as const,
            attempts: attemptsMade,
            deliveredAt: now,
            updatedAt: now,
          },
          $unset: { lastError: "" },
        },
      );
      summary.delivered += 1;
    } else if (attemptsMade >= delivery.maxAttempts) {
      await deliveries.updateOne(
        { _id: delivery._id },
        {
          $set: {
            status: "failed" as const,
            attempts: attemptsMade,
            lastError: detail,
            updatedAt: now,
          },
        },
      );
      summary.failed += 1;
    } else {
      await deliveries.updateOne(
        { _id: delivery._id },
        {
          $set: {
            attempts: attemptsMade,
            nextAttemptAt: nextAttemptAt(attemptsMade, now),
            lastError: detail,
            updatedAt: now,
          },
        },
      );
      summary.retrying += 1;
    }
  }
  return summary;
}
