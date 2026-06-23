import { ObjectId } from "mongodb";
import type Stripe from "stripe";

import {
  corporateAccountsCollection,
  subscriptionsCollection,
  usersCollection,
} from "@/lib/collections";
import { newDocumentMeta } from "@/lib/models";
import type { CorporateAccount, Subscription, SubscriptionStatus, User } from "@/lib/models";
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

/** Find or lazily create the Stripe customer for a company (Phase J.7) —
 * distinct from any owner/personal customer; the company card lives here. */
export async function getOrCreateCompanyStripeCustomer(account: CorporateAccount): Promise<string> {
  if (account.stripeCustomerId) return account.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: account.company,
    metadata: { corporateAccountId: account._id.toHexString() },
  });

  const accounts = await corporateAccountsCollection();
  const updated = await accounts.findOneAndUpdate(
    { _id: account._id, stripeCustomerId: { $exists: false } },
    { $set: { stripeCustomerId: customer.id, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) {
    const fresh = await accounts.findOne({ _id: account._id });
    if (fresh?.stripeCustomerId && fresh.stripeCustomerId !== customer.id) {
      return fresh.stripeCustomerId;
    }
  }
  return customer.id;
}

/** Persist the company card after its setup Checkout completes (Phase J.7).
 * Stores the payment method on the account for per-day office-coffee charges;
 * no upfront charge (rule #3). */
export async function saveCompanyCard(args: {
  corporateAccountId: ObjectId;
  stripeCustomerId: string;
  paymentMethodId: string;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  const accounts = await corporateAccountsCollection();
  await accounts.updateOne(
    { _id: args.corporateAccountId },
    {
      $set: {
        stripeCustomerId: args.stripeCustomerId,
        companyStripePaymentMethodId: args.paymentMethodId,
        updatedAt: now,
      },
    },
  );
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
  // Corporate subscriptions belong to a CorporateAccount, not a person.
  if (sub.metadata?.corporateAccountId) {
    await syncCorporateSubscriptionFromStripe(sub);
    return null;
  }

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
      $setOnInsert: { _id: new ObjectId(), ...newDocumentMeta(), createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  return updated;
}

/** Stable membership key for a card-on-file subscriber (no Stripe recurring
 * subscription backs it — coffee is charged per-day). */
export function membershipSubKey(userId: ObjectId): string {
  return `membership:${userId.toHexString()}`;
}

/**
 * Activate (or refresh) a card-on-file membership after the signup
 * SetupIntent saves a card (Phase E). No upfront charge (critical rule #3):
 * the saved card is charged per-day at each order's cutoff. Stores the
 * default payment method on the user for off-session charges.
 */
export async function activateCardOnFileMembership(args: {
  userId: ObjectId;
  plan: PlanDefinition;
  stripeCustomerId: string;
  paymentMethodId: string;
  now?: Date;
}): Promise<void> {
  const { userId, plan, stripeCustomerId, paymentMethodId } = args;
  const now = args.now ?? new Date();
  // Cosmetic monthly window (card-on-file isn't quota-gated); ~1 month.
  const periodEnd = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);

  const [subscriptions, users] = await Promise.all([subscriptionsCollection(), usersCollection()]);
  const key = membershipSubKey(userId);
  const existing = await subscriptions.findOne({ stripeSubscriptionId: key });

  await subscriptions.updateOne(
    { stripeSubscriptionId: key },
    {
      $set: {
        userId,
        plan: plan.plan,
        stripeCustomerId,
        billingMode: "card_on_file" as const,
        status: "active" as const,
        cancelAtPeriodEnd: false,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        "quota.total": plan.quota,
        ...(existing ? {} : { "quota.used": 0 }),
        updatedAt: now,
      },
      $setOnInsert: { _id: new ObjectId(), ...newDocumentMeta(), createdAt: now },
    },
    { upsert: true },
  );

  await users.updateOne(
    { _id: userId },
    { $set: { defaultPaymentMethodId: paymentMethodId, stripeCustomerId, updatedAt: now } },
  );
}

/** Synthetic per-member key under the company's single Stripe subscription —
 * keeps the unique stripeSubscriptionId index and the order engine working
 * unchanged for corporate members. */
export function corporateMemberSubKey(accountId: ObjectId, userId: ObjectId): string {
  return `corp:${accountId.toHexString()}:${userId.toHexString()}`;
}

/**
 * Upsert one member's Subscription document from the company's billing
 * state. Quota usage resets on period rollover, same as personal plans.
 */
export async function upsertCorporateMemberSubscription(
  account: CorporateAccount,
  memberUserId: ObjectId,
  now: Date = new Date(),
): Promise<void> {
  if (!account.currentPeriodStart || !account.currentPeriodEnd) return;

  const subscriptions = await subscriptionsCollection();
  const key = corporateMemberSubKey(account._id, memberUserId);
  const existing = await subscriptions.findOne({ stripeSubscriptionId: key });
  const isNewPeriod =
    !existing || existing.currentPeriodStart.getTime() !== account.currentPeriodStart.getTime();

  await subscriptions.updateOne(
    { stripeSubscriptionId: key },
    {
      $set: {
        userId: memberUserId,
        plan: "corporate" as const,
        stripeCustomerId: account.stripeCustomerId ?? "corporate",
        status: account.status ?? "incomplete",
        cancelAtPeriodEnd: false,
        currentPeriodStart: account.currentPeriodStart,
        currentPeriodEnd: account.currentPeriodEnd,
        "quota.total": PLANS.corporate.quota,
        ...(isNewPeriod ? { "quota.used": 0 } : {}),
        updatedAt: now,
      },
      $setOnInsert: { _id: new ObjectId(), ...newDocumentMeta(), createdAt: now },
    },
    { upsert: true },
  );
}

/** Mark a removed member's seat subscription canceled (order engine stops
 * generating for them immediately). */
export async function cancelCorporateMemberSubscription(
  accountId: ObjectId,
  memberUserId: ObjectId,
  now: Date = new Date(),
): Promise<void> {
  const subscriptions = await subscriptionsCollection();
  await subscriptions.updateOne(
    { stripeSubscriptionId: corporateMemberSubKey(accountId, memberUserId) },
    { $set: { status: "canceled" as const, updatedAt: now } },
  );
}

/**
 * Sync a corporate Stripe subscription: update the account's billing state
 * and refresh every member's seat subscription. Seat count follows the
 * Stripe line-item quantity (Stripe is the source of truth).
 */
export async function syncCorporateSubscriptionFromStripe(sub: Stripe.Subscription): Promise<void> {
  const accountIdRaw = sub.metadata?.corporateAccountId;
  if (!accountIdRaw || !ObjectId.isValid(accountIdRaw)) {
    console.error(`Corporate subscription ${sub.id} has an invalid account id; skipping.`);
    return;
  }

  const accounts = await corporateAccountsCollection();
  const item = sub.items.data[0];
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const now = new Date();

  const account = await accounts.findOneAndUpdate(
    { _id: new ObjectId(accountIdRaw) },
    {
      $set: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        status: mapStripeStatus(sub),
        seatCount: item.quantity ?? 1,
        currentPeriodStart: new Date(item.current_period_start * 1000),
        currentPeriodEnd: new Date(item.current_period_end * 1000),
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!account) {
    console.error(`Corporate subscription ${sub.id}: account ${accountIdRaw} not found.`);
    return;
  }

  for (const memberUserId of account.memberUserIds) {
    await upsertCorporateMemberSubscription(account, memberUserId, now);
  }
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
