import type { CourierProvider } from "@/lib/models";

/**
 * Provider-agnostic courier interface (v2.1, critical rule #5). Order, payout,
 * and quality logic only ever talk to the `Delivery` state machine and this
 * interface — never a provider SDK directly. Lalamove is the first adapter,
 * Grab is a second adapter behind the same shape, and a future own-fleet
 * option is just another adapter.
 */

/** A pickup or drop-off point. */
export interface CourierStop {
  address: string;
  lat: number;
  lng: number;
}

/** Contact details attached to a dispatch (sender = vendor, recipient = user). */
export interface CourierContact {
  name: string;
  phone: string;
  /** Free-text note for the driver (e.g. unit number, drink summary). */
  remarks?: string;
}

/** Minimal description of what's being delivered (one coffee, sizing, etc.). */
export interface CourierDrinkMeta {
  description: string;
}

export interface CourierQuote {
  quotationId: string;
  /** Courier fee in sen (MYR) — a platform cost, never charged to the user. */
  feeAmountSen: number;
  /** Quotes are short-lived (Lalamove ~5 min); re-quote past this. */
  expiresAt: Date;
  /** Provider stop handles needed to place the order against this quote. */
  pickupStopId?: string;
  dropoffStopId?: string;
}

export interface CourierDispatchResult {
  courierOrderId: string;
  /** Provider share/tracking link, when the provider returns one. */
  trackingUrl: string | null;
}

export interface CourierDriver {
  name: string | null;
  phone: string | null;
  plate: string | null;
}

export interface CourierTracking {
  /** Raw provider status string. */
  status: string;
  driver: CourierDriver | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Parsed, provider-neutral view of an inbound courier webhook. `deliveryStatus`
 * is null for informational events (driver assigned, amount changed) that carry
 * no state-machine transition but may still update driver details/location.
 */
export interface CourierWebhookEvent {
  courierOrderId: string;
  /** Raw provider status for storage/debugging. */
  rawStatus: string | null;
  /** The Delivery state this maps to, or null for info-only events. */
  deliveryStatus: import("@/lib/models").DeliveryStatus | null;
  /** Provider event time — used to order out-of-order deliveries. */
  eventAt: Date;
  driver: CourierDriver | null;
  lat: number | null;
  lng: number | null;
}

export interface CourierAdapter {
  readonly provider: CourierProvider;
  getQuote(
    pickup: CourierStop,
    dropoff: CourierStop,
    drink: CourierDrinkMeta,
  ): Promise<CourierQuote>;
  dispatch(
    quote: CourierQuote,
    pickup: CourierStop,
    dropoff: CourierStop,
    contacts: { sender: CourierContact; recipient: CourierContact },
    /** Idempotency key so a retried dispatch never places two courier orders. */
    idempotencyKey: string,
  ): Promise<CourierDispatchResult>;
  getTracking(courierOrderId: string): Promise<CourierTracking>;
  cancel(courierOrderId: string): Promise<void>;
  /** Verify a raw webhook body+headers against the provider's signing secret. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  /** Parse a verified webhook body into the neutral event shape, or null. */
  parseWebhook(rawBody: string): CourierWebhookEvent | null;
  /** Whether the adapter has the credentials it needs to make live calls. */
  isConfigured(): boolean;
}
