import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  activateCardOnFileMembership,
  saveCompanyCard,
  syncSubscriptionFromStripe,
} from "@/lib/billing";
import { webhookEventsCollection } from "@/lib/collections";
import { requireEnv } from "@/lib/env";
import { applyAccountStatus } from "@/lib/payments/connect";
import { handleChargeDispute } from "@/lib/payments/refund";
import { PLANS } from "@/lib/plans";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  // Phase E — Connect onboarding status + dispute handling.
  "account.updated",
  "charge.dispute.created",
]);

/** Activate a card-on-file membership from a completed setup Checkout
 * Session: pull the saved payment method off the SetupIntent and persist it.
 * No-op for sessions that aren't membership setups. */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "setup" || session.metadata?.kind !== "membership_setup") return;

  const userIdRaw = session.metadata?.userId;
  const planKey = session.metadata?.plan;
  if (!userIdRaw || !ObjectId.isValid(userIdRaw) || !planKey || !(planKey in PLANS)) {
    console.error(`checkout.session.completed ${session.id}: bad membership metadata; skipping.`);
    return;
  }

  const setupIntentId =
    typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!setupIntentId) {
    console.error(`checkout.session.completed ${session.id}: no setup_intent; skipping.`);
    return;
  }

  const stripe = getStripe();
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!paymentMethodId || !customerId) {
    console.error(`checkout.session.completed ${session.id}: no card/customer; skipping.`);
    return;
  }

  // Make this the customer's default for any future off-session charge.
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  await activateCardOnFileMembership({
    userId: new ObjectId(userIdRaw),
    plan: PLANS[planKey as keyof typeof PLANS],
    stripeCustomerId: customerId,
    paymentMethodId,
  });
}

/** Persist the company card from a completed setup Checkout (Phase J.7).
 * No-op for sessions that aren't company-card setups. */
async function handleCompanyCardSetup(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "setup" || session.metadata?.kind !== "company_card_setup") return;

  const accountIdRaw = session.metadata?.corporateAccountId;
  if (!accountIdRaw || !ObjectId.isValid(accountIdRaw)) {
    console.error(`checkout.session.completed ${session.id}: bad company-card metadata; skipping.`);
    return;
  }

  const setupIntentId =
    typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!setupIntentId) {
    console.error(`checkout.session.completed ${session.id}: no setup_intent; skipping.`);
    return;
  }

  const stripe = getStripe();
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!paymentMethodId || !customerId) {
    console.error(`checkout.session.completed ${session.id}: no card/customer; skipping.`);
    return;
  }

  // Default for future off-session office-coffee charges.
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  await saveCompanyCard({
    corporateAccountId: new ObjectId(accountIdRaw),
    stripeCustomerId: customerId,
    paymentMethodId,
  });
}

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
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      // One of these matches by metadata.kind; the other is a no-op.
      await handleCheckoutCompleted(session);
      await handleCompanyCardSetup(session);
      return NextResponse.json({ received: true });
    }

    // Phase E: Connect account capability changes → refresh the vendor's
    // charges/payouts-enabled flags (gates payouts).
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      await applyAccountStatus(
        account.id,
        Boolean(account.charges_enabled),
        Boolean(account.payouts_enabled),
      );
      return NextResponse.json({ received: true });
    }

    // Phase E: a disputed coffee charge → reverse the vendor transfer (if
    // paid) and mark the order refunded.
    if (event.type === "charge.dispute.created") {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId =
        typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
      if (paymentIntentId) await handleChargeDispute(paymentIntentId);
      return NextResponse.json({ received: true });
    }

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
