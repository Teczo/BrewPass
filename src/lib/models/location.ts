import { z } from "zod";

import { baseDocumentSchema, geoPointSchema, objectIdSchema } from "@/lib/models/shared";

export const locationSchema = baseDocumentSchema.extend({
  userId: objectIdSchema,
  /** e.g. "Home", "Office". */
  label: z.string().min(1),
  address: z.string().min(1),
  /** Geocoded via Google Maps Platform when the address is saved. */
  geo: geoPointSchema,
  notes: z.string().optional(),
});
export type Location = z.infer<typeof locationSchema>;
