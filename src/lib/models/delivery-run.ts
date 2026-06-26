import { z } from "zod";

import { baseDocumentSchema, geoPointSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * Phase L.1 — consolidated delivery. A `DeliveryRun` groups several Orders
 * (potentially across DIFFERENT vendors) into ONE physical delivery to one
 * location at one time — e.g. an office wants a flat white from Café A and a
 * cold brew from Café B, arriving together at 9am.
 *
 * The run is ONLY the delivery grouping (critical rule #22): each Order is
 * still made, charged, and PAID per-vendor and delivery-gated independently,
 * and confirmation is per-Order (L.2), never per-run. A partial failure
 * refunds exactly the missing Order(s) and pays the rest. A run is mutually
 * exclusive with a Vendor Pack on the same delivery (a Pack is single-vendor by
 * definition).
 *
 * Additive and optional: existing single-vendor deliveries carry no run and are
 * completely unaffected. The actual multi-stop courier dispatch (L.3) is an
 * external dependency that has not been validated — `courierRunId` is reserved
 * for it but no adapter populates it yet, so a run is a planning/aggregation
 * record until multi-stop courier capability is confirmed.
 */

/**
 * Run lifecycle, an AGGREGATE derived from the member Orders' own statuses
 * (L.2) — never a gate on any Order's money path:
 *  - `planned` — created, no member Order has reached a terminal state yet.
 *  - `dispatched` — a multi-stop courier job is live (reserved for L.3).
 *  - `completed` — every member Order was delivered.
 *  - `partially_failed` — some delivered, some failed (each handled per-Order).
 *  - `failed` — every member Order failed.
 */
export const deliveryRunStatusSchema = z.enum([
  "planned",
  "dispatched",
  "completed",
  "partially_failed",
  "failed",
]);
export type DeliveryRunStatus = z.infer<typeof deliveryRunStatusSchema>;

/**
 * One vendor pickup within the run: the rider collects this vendor's
 * `orderIds` at a single stop. The array order is the planned route order
 * (Café A → Café B → drop). For L.3 the courier multi-stop job is built from
 * these stops; until then it documents the intended route.
 */
export const pickupStopSchema = z.object({
  vendorId: objectIdSchema,
  orderIds: z.array(objectIdSchema).min(1),
});
export type PickupStop = z.infer<typeof pickupStopSchema>;

/** The single shared drop the whole run is delivered to. */
export const dropLocationSchema = z.object({
  label: z.string(),
  address: z.string(),
  geo: geoPointSchema,
});
export type DropLocation = z.infer<typeof dropLocationSchema>;

export const deliveryRunSchema = baseDocumentSchema.extend({
  /** Every Order in the run (the flat membership; `pickupStops` is the same set
   * grouped by vendor). Each stays an independent, delivery-gated Order. */
  orderIds: z.array(objectIdSchema).min(1),
  dropLocation: dropLocationSchema,
  /** UTC instant the consolidated drop should arrive. */
  targetDeliveryTime: z.date(),
  /** Member Orders grouped by vendor, in planned pickup-route order. */
  pickupStops: z.array(pickupStopSchema).min(1),
  /** Multi-stop courier job reference (L.3) — reserved; unset until a courier
   * with confirmed multi-stop pickup support populates it. */
  courierRunId: z.string().optional(),
  status: deliveryRunStatusSchema,
  /** Optional context — an office is the most likely first consumer of a run
   * (a whole team getting one consolidated drop), forward-referenced in J.6. */
  corporateAccountId: objectIdSchema.optional(),
});
export type DeliveryRun = z.infer<typeof deliveryRunSchema>;
