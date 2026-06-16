import { z } from "zod";

import { objectIdSchema } from "@/lib/models/shared";

/**
 * Processed external webhook events (Stripe + couriers). A unique index on
 * (source, eventId) makes webhook handling idempotent: duplicate
 * deliveries are claimed exactly once. Courier events (v2.1) are keyed
 * `${provider}:${courierOrderId}:${deliveryStatus}` so a retried or
 * out-of-order status delivery is processed at most once.
 */
export const webhookEventSchema = z.object({
  _id: objectIdSchema,
  source: z.enum(["stripe", "lalamove", "grab"]),
  eventId: z.string().min(1),
  type: z.string().min(1),
  receivedAt: z.date(),
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
