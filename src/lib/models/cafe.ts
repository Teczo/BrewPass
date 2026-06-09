import { z } from "zod";

import { baseDocumentSchema, geoPointSchema } from "@/lib/models/shared";

export const cafeSchema = baseDocumentSchema.extend({
  name: z.string().min(1),
  address: z.string().min(1),
  geo: geoPointSchema,
  /** Drinks/equipment the café can fulfil, e.g. "oat_milk", "cold_brew". */
  capabilities: z.array(z.string()),
  /** Max orders the café can prepare per hour. */
  capacityPerHour: z.number().int().positive(),
  /** Auth0 subs of café portal users (role `cafe`, added in Phase 4). */
  portalUserSubs: z.array(z.string()),
  active: z.boolean(),
});
export type Cafe = z.infer<typeof cafeSchema>;
