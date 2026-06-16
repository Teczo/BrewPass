import { z } from "zod";

import { baseDocumentSchema, moneySenSchema, objectIdSchema } from "@/lib/models/shared";

export const deliveryStatusSchema = z.enum([
  "pending",
  "assigned",
  "picked_up",
  "delivered",
  "failed",
]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/**
 * Who carries the order (v2.1). `lalamove`/`grab` are courier-dispatched and
 * webhook-gated; `manual` is the legacy self-delivery path (free-text rider,
 * human "mark delivered" button). Legacy rows that predate v2.1 have no value
 * and are treated as `manual` — see `deliveryProvider()`.
 */
export const courierProviderSchema = z.enum(["lalamove", "grab", "manual"]);
export type CourierProvider = z.infer<typeof courierProviderSchema>;

export const deliverySchema = baseDocumentSchema.extend({
  orderId: objectIdSchema,
  /** Legacy/manual rider assignment — free-text name (manual provider only). */
  riderId: z.string().optional(),
  status: deliveryStatusSchema,
  assignedAt: z.date().optional(),
  pickedUpAt: z.date().optional(),
  deliveredAt: z.date().optional(),
  /** Populated when status is `failed`. */
  failureReason: z.string().optional(),

  // ── Courier integration (v2.1) ──────────────────────────────────────────
  /** Selected adapter. Unset on legacy rows → treat as `manual`. */
  courierProvider: courierProviderSchema.optional(),
  /** The provider's order/delivery reference — the webhook lookup key. */
  courierOrderId: z.string().optional(),
  /** The quotation the dispatch was placed against (short-lived). */
  courierQuotationId: z.string().optional(),
  /** Last raw provider status string (for debugging / admin tooling). */
  courierStatusRaw: z.string().optional(),
  /** When the courier was dispatched (distinct from `assignedAt`). */
  dispatchedAt: z.date().optional(),
  /** Provider share/tracking link — the in-app tracking fallback. */
  trackingUrl: z.string().optional(),

  // Driver details from the provider (nullable until a driver is assigned).
  driverName: z.string().optional(),
  driverPhone: z.string().optional(),
  driverPlate: z.string().optional(),
  /** Latest driver position for the in-app map. */
  driverLat: z.number().min(-90).max(90).optional(),
  driverLng: z.number().min(-180).max(180).optional(),
  driverLocationUpdatedAt: z.date().optional(),

  /**
   * What the platform paid the courier, in sen — an INTERNAL margin figure.
   * Never shown to the user as a charge, never deducted from the vendor net
   * (critical rule #7).
   */
  courierFeeAmountSen: moneySenSchema.optional(),
});
export type Delivery = z.infer<typeof deliverySchema>;

/** Effective provider for a delivery row; legacy/unset rows are `manual`. */
export function deliveryProvider(delivery: Pick<Delivery, "courierProvider">): CourierProvider {
  return delivery.courierProvider ?? "manual";
}
