import { ObjectId } from "mongodb";

import {
  deliveriesCollection,
  ordersCollection,
  usersCollection,
  vendorsCollection,
  webhookEventsCollection,
} from "@/lib/collections";
import { getCourierAdapter, resolveCourierProvider } from "@/lib/courier";
import { priorStatesFor, shouldApplyTransition } from "@/lib/courier/status";
import type { CourierWebhookEvent } from "@/lib/courier/types";
import { newDocumentMeta } from "@/lib/models";
import type { CourierProvider, DeliveryStatus, Order, Vendor } from "@/lib/models";
import { sendSms } from "@/lib/notifications";
import { handleOrderDelivered } from "@/lib/payments/payout";
import { refundFailedDelivery } from "@/lib/payments/refund";
import { isOnTime } from "@/lib/quality";
import { recordDelivery } from "@/lib/quality-service";

/**
 * Courier orchestration (v2.1) — the database-touching seam between the
 * `Delivery` state machine and the courier adapters. Two entry points:
 *  - `dispatchForHandoff` runs on `preparing → out_for_delivery`.
 *  - `applyCourierWebhookEvent` runs the courier webhook into the state
 *    machine and gates payout/refund.
 *
 * Both are idempotent (critical rule #1): a re-clicked handoff never
 * double-dispatches, and a retried/out-of-order webhook never double-pays,
 * double-refunds, or moves the state machine backwards (rules #5, #6).
 */

const MAX_DISPATCH_ATTEMPTS = 3;
const DISPATCH_RETRY_DELAY_MS = 250;

/** Sender phone for the courier when a vendor has no contact number stored. */
function platformPhone(): string {
  return process.env.COURIER_PLATFORM_PHONE ?? "+60000000000";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type HandoffOutcome =
  | { status: "manual" }
  | { status: "dispatched"; provider: CourierProvider; trackingUrl: string | null }
  | { status: "failed"; reason: string };

/**
 * Create the delivery for an order being handed off. For `manual` vendors this
 * is the legacy pending-delivery stub. For courier vendors it dispatches a real
 * courier (re-quoting at dispatch time) and records the courier refs.
 *
 * Idempotent on `orderId` (unique index): a re-click that finds an
 * already-dispatched delivery is a no-op, and the courier order placement
 * carries a per-order idempotency key so the provider never double-books.
 * Returns `failed` only when a courier dispatch genuinely fails after retries —
 * the caller then fails + refunds the order (the chosen dispatch-failure policy).
 */
export async function dispatchForHandoff(
  order: Order,
  vendor: Vendor,
  now: Date = new Date(),
): Promise<HandoffOutcome> {
  const deliveries = await deliveriesCollection();
  const provider = resolveCourierProvider(vendor);

  // Claim the single delivery for this order. A duplicate means a prior
  // handoff already created it — never dispatch twice.
  const existing = await deliveries.findOne({ orderId: order._id });
  if (existing) {
    if (existing.courierOrderId) {
      return {
        status: "dispatched",
        provider: existing.courierProvider ?? provider,
        trackingUrl: existing.trackingUrl ?? null,
      };
    }
    if ((existing.courierProvider ?? "manual") === "manual") {
      return { status: "manual" };
    }
    // A courier delivery exists but was never placed (a prior attempt failed
    // mid-flight) — fall through and (re)dispatch onto it.
  }

  if (provider === "manual") {
    await insertManualDelivery(order._id, now);
    return { status: "manual" };
  }

  const adapter = getCourierAdapter(provider);
  if (!adapter) {
    // Shouldn't happen (resolveCourierProvider only returns configured
    // providers), but fail closed to the chosen policy rather than stall.
    return { status: "failed", reason: "no_adapter" };
  }

  // Ensure a pending courier delivery row exists to attach refs to.
  if (!existing) {
    try {
      await deliveries.insertOne({
        _id: new ObjectId(),
        ...newDocumentMeta(),
        orderId: order._id,
        status: "pending",
        courierProvider: provider,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // Concurrent handoff won the insert — re-read and bail to its outcome.
      const raced = await deliveries.findOne({ orderId: order._id });
      if (raced?.courierOrderId) {
        return {
          status: "dispatched",
          provider: raced.courierProvider ?? provider,
          trackingUrl: raced.trackingUrl ?? null,
        };
      }
    }
  }

  const contacts = await buildContacts(order, vendor);
  const pickup = { address: vendor.address, lat: vendor.geo.lat, lng: vendor.geo.lng };
  const dropoff = {
    address: order.location.address,
    lat: order.location.geo.lat,
    lng: order.location.geo.lng,
  };
  const drink = { description: `${order.drink.size} ${order.drink.drink}` };

  let lastError = "dispatch_failed";
  for (let attempt = 1; attempt <= MAX_DISPATCH_ATTEMPTS; attempt += 1) {
    try {
      // Re-quote at dispatch time — quotations are short-lived (~5 min).
      const quote = await adapter.getQuote(pickup, dropoff, drink);
      const result = await adapter.dispatch(
        quote,
        pickup,
        dropoff,
        contacts,
        `dispatch_${order._id.toHexString()}`,
      );
      await deliveries.updateOne(
        { orderId: order._id },
        {
          $set: {
            status: "assigned",
            courierProvider: provider,
            courierOrderId: result.courierOrderId,
            courierQuotationId: quote.quotationId,
            courierFeeAmountSen: quote.feeAmountSen,
            trackingUrl: result.trackingUrl ?? undefined,
            dispatchedAt: now,
            assignedAt: now,
            updatedAt: now,
          },
        },
      );
      return { status: "dispatched", provider, trackingUrl: result.trackingUrl };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "dispatch_failed";
      console.error(
        `Courier dispatch attempt ${attempt}/${MAX_DISPATCH_ATTEMPTS} for order ${order._id.toHexString()} failed:`,
        error,
      );
      if (attempt < MAX_DISPATCH_ATTEMPTS) await sleep(DISPATCH_RETRY_DELAY_MS);
    }
  }

  // Out of retries — mark the delivery failed; the caller fails + refunds.
  await deliveries.updateOne(
    { orderId: order._id },
    {
      $set: {
        status: "failed",
        failureReason: `courier_dispatch_failed: ${lastError}`.slice(0, 300),
        updatedAt: now,
      },
    },
  );
  return { status: "failed", reason: lastError };
}

async function insertManualDelivery(orderId: ObjectId, now: Date): Promise<void> {
  const deliveries = await deliveriesCollection();
  try {
    await deliveries.insertOne({
      _id: new ObjectId(),
      ...newDocumentMeta(),
      orderId,
      status: "pending",
      courierProvider: "manual",
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
}

async function buildContacts(order: Order, vendor: Vendor) {
  const users = await usersCollection();
  const user = await users.findOne({ _id: order.userId });
  const recipientPhone = user?.phone ?? platformPhone();
  const remarks = order.drink.notes
    ? `${order.location.label}: ${order.drink.drink} — ${order.drink.notes}`
    : `${order.location.label}: ${order.drink.drink}`;
  return {
    sender: { name: vendor.businessName, phone: platformPhone() },
    recipient: {
      name: user?.name ?? "BrewPass customer",
      phone: recipientPhone,
      remarks: remarks.slice(0, 200),
    },
  };
}

export type WebhookOutcome = {
  ok: true;
  transitioned: DeliveryStatus | null;
  duplicate?: boolean;
  reason?: string;
};

/**
 * Apply a verified, parsed courier webhook to the `Delivery`/`Order` state
 * machines. Idempotent and out-of-order tolerant (critical rule #6):
 *  - driver details/location are updated best-effort, newest-wins;
 *  - a state transition is claimed exactly once per (provider, courierOrderId,
 *    targetStatus) via the webhookEvents index, and only ever advances;
 *  - `delivered` releases the (delivery-gated) payout, `failed` refunds the day.
 *
 * Throws on a side-effect failure so the route returns 500 and the provider
 * retries — the claim is released first, and every side effect is itself
 * idempotent, so payout is never lost or duplicated.
 */
export async function applyCourierWebhookEvent(
  provider: Exclude<CourierProvider, "manual">,
  event: CourierWebhookEvent,
  now: Date = new Date(),
): Promise<WebhookOutcome> {
  const deliveries = await deliveriesCollection();
  const delivery = await deliveries.findOne({
    courierOrderId: event.courierOrderId,
    courierProvider: provider,
  });
  // Unknown order, or one we don't track for this provider — ignore safely.
  if (!delivery) return { ok: true, transitioned: null, reason: "unknown_order" };

  await recordDriverUpdate(delivery.orderId, event, now);

  const target = event.deliveryStatus;
  if (!target) return { ok: true, transitioned: null };
  if (!shouldApplyTransition(delivery.status, target)) {
    return { ok: true, transitioned: null, reason: "stale_or_backward" };
  }

  // Claim this exact transition. A real duplicate (already fully processed)
  // collides on the unique index and is acknowledged without reprocessing.
  const webhooks = await webhookEventsCollection();
  const eventId = `${provider}:${event.courierOrderId}:${target}`;
  try {
    await webhooks.insertOne({
      _id: new ObjectId(),
      source: provider,
      eventId,
      type: `courier.${target}`,
      receivedAt: now,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: true, transitioned: null, duplicate: true };
    throw error;
  }

  try {
    await applyTransition(delivery.orderId, target, event.rawStatus, now);
    return { ok: true, transitioned: target };
  } catch (error) {
    // Release the claim so the provider's retry reprocesses (side effects are
    // idempotent, so this can never double-pay/refund).
    await webhooks.deleteOne({ source: provider, eventId });
    throw error;
  }
}

/** Move the delivery + order for a confirmed transition and run its money/
 * quality side effects. Safe to run more than once for the same target. */
async function applyTransition(
  orderId: ObjectId,
  target: DeliveryStatus,
  rawStatus: string | null,
  now: Date,
): Promise<void> {
  const deliveries = await deliveriesCollection();
  const orders = await ordersCollection();

  const timestampField =
    target === "picked_up" ? "pickedUpAt" : target === "delivered" ? "deliveredAt" : undefined;
  await deliveries.updateOne(
    { orderId, status: { $in: priorStatesFor(target) } },
    {
      $set: {
        status: target,
        ...(rawStatus ? { courierStatusRaw: rawStatus } : {}),
        ...(timestampField ? { [timestampField]: now } : {}),
        updatedAt: now,
      },
    },
  );

  if (target === "delivered") {
    const order = await orders.findOne({ _id: orderId });
    await orders.updateOne(
      { _id: orderId, status: "out_for_delivery" },
      { $set: { status: "delivered", updatedAt: now } },
    );
    // Delivery-gated payout (rule #4) — idempotent; never lost or duplicated.
    await handleOrderDelivered(orderId, now);
    if (order) {
      // Best-effort quality + SMS; must not fail the (already money-gating) tx.
      try {
        await recordDelivery(order.vendorId, isOnTime(now, order.deliverAt), now);
      } catch (error) {
        console.error(`On-time metric for order ${orderId.toHexString()} failed:`, error);
      }
      await notifyDelivered(order);
    }
    return;
  }

  if (target === "failed") {
    await orders.updateOne(
      { _id: orderId, status: "out_for_delivery" },
      {
        $set: {
          status: "failed",
          failureReason: `courier_failed: ${rawStatus ?? "unknown"}`.slice(0, 300),
          updatedAt: now,
        },
      },
    );
    // Delivery failed → refund the day; no transfer was ever released. Idempotent.
    await refundFailedDelivery(orderId, now);
  }
  // picked_up: delivery-only; the order stays out_for_delivery.
}

async function notifyDelivered(order: Order): Promise<void> {
  const users = await usersCollection();
  const customer = await users.findOne({ _id: order.userId });
  if (!customer?.phone) return;
  try {
    await sendSms(
      customer.phone,
      `BrewPass: your ${order.drink.drink} has been delivered to ${order.location.label}. Enjoy! ☕`,
    );
  } catch (error) {
    console.error("Delivered SMS failed:", error);
  }
}

/** Persist the latest driver identity/location for the in-app map. Location is
 * newest-wins (guarded by `driverLocationUpdatedAt`); identity is cheap to set. */
async function recordDriverUpdate(
  orderId: ObjectId,
  event: CourierWebhookEvent,
  now: Date,
): Promise<void> {
  const deliveries = await deliveriesCollection();

  const identity: Record<string, unknown> = { updatedAt: now };
  if (event.rawStatus) identity.courierStatusRaw = event.rawStatus;
  if (event.driver?.name) identity.driverName = event.driver.name;
  if (event.driver?.phone) identity.driverPhone = event.driver.phone;
  if (event.driver?.plate) identity.driverPlate = event.driver.plate;
  await deliveries.updateOne({ orderId }, { $set: identity });

  if (event.lat != null && event.lng != null) {
    await deliveries.updateOne(
      {
        orderId,
        $or: [
          { driverLocationUpdatedAt: { $exists: false } },
          { driverLocationUpdatedAt: { $lt: event.eventAt } },
        ],
      },
      {
        $set: {
          driverLat: event.lat,
          driverLng: event.lng,
          driverLocationUpdatedAt: event.eventAt,
          updatedAt: now,
        },
      },
    );
  }
}

/**
 * On-demand tracking refresh for the customer map: poll the adapter for the
 * driver's latest position and persist it. Best-effort — returns false (and
 * leaves the last-known location) when the courier isn't reachable. Only the
 * driver location/identity is touched; the state machine is webhook-driven.
 */
export async function refreshTrackingLocation(
  orderId: ObjectId,
  now: Date = new Date(),
): Promise<boolean> {
  const deliveries = await deliveriesCollection();
  const delivery = await deliveries.findOne({ orderId });
  const provider = delivery?.courierProvider;
  if (!delivery?.courierOrderId || !provider || provider === "manual") return false;

  const adapter = getCourierAdapter(provider);
  if (!adapter?.isConfigured()) return false;

  try {
    const tracking = await adapter.getTracking(delivery.courierOrderId);
    const set: Record<string, unknown> = { courierStatusRaw: tracking.status, updatedAt: now };
    if (tracking.driver?.name) set.driverName = tracking.driver.name;
    if (tracking.driver?.phone) set.driverPhone = tracking.driver.phone;
    if (tracking.driver?.plate) set.driverPlate = tracking.driver.plate;
    if (tracking.lat != null && tracking.lng != null) {
      set.driverLat = tracking.lat;
      set.driverLng = tracking.lng;
      set.driverLocationUpdatedAt = now;
    }
    await deliveries.updateOne({ orderId }, { $set: set });
    return true;
  } catch (error) {
    console.error(`Tracking refresh for order ${orderId.toHexString()} failed:`, error);
    return false;
  }
}

export type AdminCourierResult =
  | { ok: true; outcome?: HandoffOutcome }
  | { ok: false; reason: string };

/**
 * Admin override: force a stuck courier order to `delivered` and release payout
 * (v2.1) — for when the courier completed but the webhook never arrived. Goes
 * through the same idempotent transition as the webhook, so payout is released
 * exactly once.
 */
export async function adminMarkDelivered(
  orderId: ObjectId,
  now: Date = new Date(),
): Promise<AdminCourierResult> {
  const orders = await ordersCollection();
  const order = await orders.findOne({ _id: orderId });
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.status !== "out_for_delivery") {
    return { ok: false, reason: "not_out_for_delivery" };
  }
  await applyTransition(orderId, "delivered", "ADMIN_OVERRIDE", now);
  return { ok: true };
}

/**
 * Admin override: re-dispatch a courier for a stuck order (v2.1) — e.g. the
 * courier cancelled mid-delivery, or the original dispatch failed. Best-effort
 * cancels any prior courier order, resets the delivery, returns the order to
 * `out_for_delivery`, and dispatches afresh (new courierOrderId). Never
 * double-pays the vendor (payout is still gated on a fresh delivery event).
 */
export async function adminRedispatchCourier(
  orderId: ObjectId,
  now: Date = new Date(),
): Promise<AdminCourierResult> {
  const orders = await ordersCollection();
  const order = await orders.findOne({ _id: orderId });
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.status !== "out_for_delivery" && order.status !== "failed") {
    return { ok: false, reason: "not_redispatchable" };
  }

  const vendors = await vendorsCollection();
  const vendor = await vendors.findOne({ _id: order.vendorId });
  if (!vendor) return { ok: false, reason: "vendor_not_found" };

  const deliveries = await deliveriesCollection();
  const existing = await deliveries.findOne({ orderId });

  // Best-effort cancel of the prior courier order so we never run two at once.
  if (existing?.courierOrderId && existing.courierProvider) {
    const adapter = getCourierAdapter(existing.courierProvider);
    if (adapter?.isConfigured()) {
      try {
        await adapter.cancel(existing.courierOrderId);
      } catch (error) {
        console.error(`Cancel before re-dispatch ${orderId.toHexString()} failed:`, error);
      }
    }
    // Clear the prior refs so dispatchForHandoff re-places onto this delivery.
    await deliveries.updateOne(
      { orderId },
      {
        $set: { status: "pending", updatedAt: now },
        $unset: { courierOrderId: "", courierQuotationId: "" },
      },
    );
  }

  // Re-open the order for delivery (it may have been failed by the policy).
  await orders.updateOne(
    { _id: orderId },
    { $set: { status: "out_for_delivery", updatedAt: now }, $unset: { failureReason: "" } },
  );
  const reopened = await orders.findOne({ _id: orderId });
  const outcome = await dispatchForHandoff(reopened!, vendor, now);
  return { ok: true, outcome };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
