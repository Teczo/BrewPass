import { ObjectId } from "mongodb";
import type Stripe from "stripe";

import { subscriptionsCollection, usersCollection } from "@/lib/collections";
import type { Subscription, SubscriptionStatus, User } from "@/lib/models";
import { PLANS, planByLookupKey, type PlanDefinition } from "@/lib/plans";
import { getStripe } from "@/lib/stripe";

/** Find or lazily create the Stripe customer linked to this user. */
export async function getOrCreateStripeCustomer(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user._id.toHexString() },
  });

  const users = await usersCollection();
  // Guard against a concurrent checkout creating a second customer: only
  // store ours if none was saved in the meantime, and prefer the stored one.
  const updated = await users.findOneAndUpdate(
    { _id: user._id, stripeCustomerId: { $exists: false } },
    { $set: { stripeCustomerId: customer.id, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) {
    const fresh = await users.findOne({ _id: user._id });
    if (fresh?.stripeCustomerId && fresh.stripeCustomerId !== customer.id) {
      return fresh.stripeCustomerId;
    }
  }
  return customer.id;
}

/**
 * Resolve the Stripe price for a plan by lookup key, creating the product
 * and price on first use. Idempotent: lookup keys are unique in Stripe.
 */
export async function resolvePriceId(plan: PlanDefinition): Promise<string> {
  const stripe = getStripe();
  const existing = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    active: true,
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0].id;

  const price = await stripe.prices.create({
    lookup_key: plan.lookupKey,
    currency: "myr",
    unit_amount: plan.priceSen,
    recurring: { interval: "month" },
    product_data: { name: `BrewPass ${plan.name}` },
    metadata: { plan: plan.plan },
  });
  return price.id;
}

function mapStripeStatus(sub: Stripe.Subscription): SubscriptionStatus {
  if (sub.pause_collection) return "paused";
  switch (sub.status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "paused":
      return "paused";
    default:
      return "incomplete";
  }
}

function planFromStripeSubscription(sub: Stripe.Subscription): PlanDefinition | undefined {
  const fromMetadata = sub.metadata?.plan;
  if (fromMetadata && fromMetadata in PLANS) {
    return PLANS[fromMetadata as keyof typeof PLANS];
  }
  const lookupKey = sub.items.data[0]?.price.lookup_key;
  return lookupKey ? planByLookupKey(lookupKey) : undefined;
}

async function resolveUserId(sub: Stripe.Subscription): Promise<ObjectId | null> {
  const fromMetadata = sub.metadata?.userId;
  if (fromMetadata && ObjectId.isValid(fromMetadata)) return new ObjectId(fromMetadata);

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const users = await usersCollection();
  const user = await users.findOne({ stripeCustomerId: customerId });
  return user?._id ?? null;
}

/**
 * Upsert our Subscription document from the authoritative Stripe object.
 * Called from webhooks and after any subscription mutation. Quota usage is
 * preserved within a billing period and reset when a new period starts.
 */
export async function syncSubscriptionFromStripe(
  sub: Stripe.Subscription,
): Promise<Subscription | null> {
  const plan = planFromStripeSubscription(sub);
  if (!plan) {
    console.error(`Stripe subscription ${sub.id} has no recognizable plan; skipping sync.`);
    return null;
  }
  const userId = await resolveUserId(sub);
  if (!userId) {
    console.error(`Stripe subscription ${sub.id} cannot be matched to a user; skipping sync.`);
    return null;
  }

  // Billing periods live on the subscription item in current Stripe API versions.
  const item = sub.items.data[0];
  const currentPeriodStart = new Date(item.current_period_start * 1000);
  const currentPeriodEnd = new Date(item.current_period_end * 1000);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const subscriptions = await subscriptionsCollection();
  const existing = await subscriptions.findOne({ stripeSubscriptionId: sub.id });
  const isNewPeriod =
    !existing || existing.currentPeriodStart.getTime() !== currentPeriodStart.getTime();

  const now = new Date();
  const updated = await subscriptions.findOneAndUpdate(
    { stripeSubscriptionId: sub.id },
    {
      $set: {
        userId,
        plan: plan.plan,
        stripeCustomerId: customerId,
        status: mapStripeStatus(sub),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodStart,
        currentPeriodEnd,
        "quota.total": plan.quota,
        ...(isNewPeriod ? { "quota.used": 0 } : {}),
        updatedAt: now,
      },
      $setOnInsert: { _id: new ObjectId(), createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  return updated;
}

/** The user's most relevant subscription: most recently updated non-canceled
 * one, falling back to the latest canceled record. */
export async function getCurrentSubscription(userId: ObjectId): Promise<Subscription | null> {
  const subscriptions = await subscriptionsCollection();
  const active = await subscriptions.findOne(
    { userId, status: { $ne: "canceled" } },
    { sort: { updatedAt: -1 } },
  );
  if (active) return active;
  return subscriptions.findOne({ userId }, { sort: { updatedAt: -1 } });
}
