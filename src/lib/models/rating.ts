import { z } from "zod";

import { baseDocumentSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * A subscriber's post-delivery rating of an order (Phase G). One rating per
 * order (unique on orderId). Ratings aggregate into the vendor's ratingScore,
 * which — with acceptance and on-time rates — forms the routing quality
 * tiebreak and the auto-suspend signal.
 */
export const ratingSchema = baseDocumentSchema.extend({
  orderId: objectIdSchema,
  userId: objectIdSchema,
  vendorId: objectIdSchema,
  /** 1–5 stars. */
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});
export type Rating = z.infer<typeof ratingSchema>;
