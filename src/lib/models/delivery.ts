import { z } from "zod";

import { baseDocumentSchema, objectIdSchema } from "@/lib/models/shared";

export const deliveryStatusSchema = z.enum([
  "pending",
  "assigned",
  "picked_up",
  "delivered",
  "failed",
]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const deliverySchema = baseDocumentSchema.extend({
  orderId: objectIdSchema,
  /** Rider assignment is a manual/stub step for MVP. */
  riderId: z.string().optional(),
  status: deliveryStatusSchema,
  assignedAt: z.date().optional(),
  pickedUpAt: z.date().optional(),
  deliveredAt: z.date().optional(),
  /** Populated when status is `failed`. */
  failureReason: z.string().optional(),
});
export type Delivery = z.infer<typeof deliverySchema>;
