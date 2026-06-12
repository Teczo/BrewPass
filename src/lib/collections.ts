import { Collection } from "mongodb";

import { getDb } from "@/lib/db";
import type {
  CorporateAccount,
  Delivery,
  Location,
  Order,
  Preference,
  PreferenceSignal,
  Subscription,
  User,
  Vendor,
  WebhookEvent,
} from "@/lib/models";

/** Typed accessors for every collection. Always go through these. */

export async function usersCollection(): Promise<Collection<User>> {
  return (await getDb()).collection<User>("users");
}

export async function locationsCollection(): Promise<Collection<Location>> {
  return (await getDb()).collection<Location>("locations");
}

export async function preferencesCollection(): Promise<Collection<Preference>> {
  return (await getDb()).collection<Preference>("preferences");
}

export async function subscriptionsCollection(): Promise<Collection<Subscription>> {
  return (await getDb()).collection<Subscription>("subscriptions");
}

export async function ordersCollection(): Promise<Collection<Order>> {
  return (await getDb()).collection<Order>("orders");
}

export async function vendorsCollection(): Promise<Collection<Vendor>> {
  return (await getDb()).collection<Vendor>("vendors");
}

export async function deliveriesCollection(): Promise<Collection<Delivery>> {
  return (await getDb()).collection<Delivery>("deliveries");
}

export async function corporateAccountsCollection(): Promise<Collection<CorporateAccount>> {
  return (await getDb()).collection<CorporateAccount>("corporateAccounts");
}

export async function preferenceSignalsCollection(): Promise<Collection<PreferenceSignal>> {
  return (await getDb()).collection<PreferenceSignal>("preferenceSignals");
}

export async function webhookEventsCollection(): Promise<Collection<WebhookEvent>> {
  return (await getDb()).collection<WebhookEvent>("webhookEvents");
}

/**
 * Indexes the app relies on. Idempotent — safe to call from a setup script
 * or admin route after provisioning a new database.
 */
export async function ensureIndexes(): Promise<void> {
  const [
    users,
    locations,
    preferences,
    subscriptions,
    orders,
    vendors,
    deliveries,
    signals,
    webhooks,
  ] = await Promise.all([
    usersCollection(),
    locationsCollection(),
    preferencesCollection(),
    subscriptionsCollection(),
    ordersCollection(),
    vendorsCollection(),
    deliveriesCollection(),
    preferenceSignalsCollection(),
    webhookEventsCollection(),
  ]);

  await Promise.all([
    users.createIndex({ authSub: 1 }, { unique: true }),
    locations.createIndex({ userId: 1 }),
    preferences.createIndex({ userId: 1 }, { unique: true }),
    subscriptions.createIndex({ userId: 1 }),
    subscriptions.createIndex({ stripeSubscriptionId: 1 }, { unique: true }),
    // Idempotency: one order per user per local date — the cron can never
    // double-generate (critical rule #1).
    orders.createIndex({ userId: 1, date: 1 }, { unique: true }),
    orders.createIndex({ vendorId: 1, date: 1 }),
    orders.createIndex({ status: 1, cutoffAt: 1 }),
    // Portal login resolves the operator's vendor by membership.
    vendors.createIndex({ portalUserSubs: 1 }),
    // One vendor (application) per owning user; concurrent applies collide.
    vendors.createIndex(
      { ownerUserId: 1 },
      { unique: true, partialFilterExpression: { ownerUserId: { $exists: true } } },
    ),
    deliveries.createIndex({ orderId: 1 }, { unique: true }),
    signals.createIndex({ userId: 1, date: 1 }),
    // One preference signal per confirmed order.
    signals.createIndex({ orderId: 1 }, { unique: true }),
    // Webhook idempotency: each delivered event is claimed exactly once.
    webhooks.createIndex({ source: 1, eventId: 1 }, { unique: true }),
  ]);
}
