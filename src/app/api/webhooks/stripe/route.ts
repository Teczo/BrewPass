import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { syncSubscriptionFromStripe } from "@/lib/billing";
import { webhookEventsCollection } from "@/lib/collections";
import { requireEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

const HANDLED_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

/** Pull the subscription id out of an invoice across Stripe API shapes. */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  const fromParent = parent?.subscription_details?.subscription;
  if (typeof fromParent === "string") return fromParent;
  if (fromParent && typeof fromParent === "object") return fromParent.id;
  return null;
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      payload,
      signature,
      requireEnv("STRIPE_WEBHOOK_SECRET"),
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  // Idempotency: claim the event id before processing. Duplicate deliveries
  // hit the unique index and are acknowledged without reprocessing.
  const webhookEvents = await webhookEventsCollection();
  try {
    await webhookEvents.insertOne({
      _id: new ObjectId(),
      source: "stripe",
      eventId: event.id,
      type: event.type,
      receivedAt: new Date(),
    });
  } catch (error) {
    const isDuplicate =
      typeof error === "object" && error !== null && "code" in error && error.code === 11000;
    if (isDuplicate) return NextResponse.json({ received: true, duplicate: true });
    throw error;
  }

  try {
    let subscriptionId: string | null = null;
    if (event.type.startsWith("customer.subscription.")) {
      subscriptionId = (event.data.object as Stripe.Subscription).id;
    } else {
      subscriptionId = subscriptionIdFromInvoice(event.data.object as Stripe.Invoice);
    }

    if (subscriptionId) {
      // Out-of-order safety: always sync from the *current* state in
      // Stripe rather than the (possibly stale) event payload.
      const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
      await syncSubscriptionFromStripe(subscription);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    // Release the claim so Stripe's retry can reprocess this event.
    await webhookEvents.deleteOne({ source: "stripe", eventId: event.id });
    console.error(`Stripe webhook ${event.type} (${event.id}) failed:`, error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
