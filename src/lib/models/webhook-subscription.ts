import { z } from "zod";

import { baseDocumentSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * Outbound webhook lifecycle event types (Phase I.5). The platform emits
 * these to registered subscribers as core actions reach an authoritative
 * state. Emission is additive and best-effort — it never blocks or alters
 * the order/charge/payout/refund flow, exactly like notifications (critical
 * rule #13).
 */
export const webhookEventTypeSchema = z.enum([
  "order.scheduled",
  "vendor.assigned",
  "order.confirmed",
  "order.delivered",
  "order.failed",
  "payout.released",
  "refund.issued",
]);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

export const WEBHOOK_EVENT_TYPES = webhookEventTypeSchema.options;

/**
 * A registered outbound-webhook endpoint (Phase I.5), managed by admins.
 * Each subscription carries its own HMAC signing secret so a receiver can
 * verify authenticity, and an `eventTypes` filter (empty = every type).
 */
export const webhookSubscriptionSchema = baseDocumentSchema.extend({
  /** HTTPS endpoint events are POSTed to. */
  url: z.string().url(),
  /** Per-subscription HMAC-SHA256 signing secret. Generated on create. */
  secret: z.string().min(1),
  /** Event types this endpoint receives; empty array = all types. */
  eventTypes: z.array(webhookEventTypeSchema),
  active: z.boolean(),
  description: z.string().max(200).optional(),
});
export type WebhookSubscription = z.infer<typeof webhookSubscriptionSchema>;

/**
 * One delivery attempt-set of a single event to a single subscription
 * (Phase I.5). Enqueued when an event is emitted; the retry cron drives it to
 * a terminal `delivered`/`failed`. The unique (subscriptionId, eventId) index
 * makes delivery idempotent: re-emitting the same logical event (e.g. an
 * idempotent cron re-run) never enqueues a duplicate (critical rule #1).
 */
export const webhookDeliverySchema = baseDocumentSchema.extend({
  subscriptionId: objectIdSchema,
  /** Stable idempotency key for the logical event, e.g.
   * `order.delivered:<orderExternalId>`. Shared across subscriptions. */
  eventId: z.string().min(1),
  eventType: webhookEventTypeSchema,
  url: z.string().url(),
  /** The full signed envelope body, stored so retries resend it verbatim. */
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "delivered", "failed"]),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: z.date(),
  lastAttemptAt: z.date().optional(),
  lastError: z.string().optional(),
  deliveredAt: z.date().optional(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
