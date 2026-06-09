import { z } from "zod";

import { objectIdSchema } from "@/lib/models/shared";

/**
 * Processed external webhook events (Stripe for now). A unique index on
 * (source, eventId) makes webhook handling idempotent: duplicate
 * deliveries are claimed exactly once.
 */
export const webhookEventSchema = z.object({
  _id: objectIdSchema,
  source: z.enum(["stripe"]),
  eventId: z.string().min(1),
  type: z.string().min(1),
  receivedAt: z.date(),
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
