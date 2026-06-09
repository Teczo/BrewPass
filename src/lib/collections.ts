import { Collection } from "mongodb";

import { getDb } from "@/lib/db";
import type {
  Cafe,
  CorporateAccount,
  Delivery,
  Location,
  Order,
  Preference,
  PreferenceSignal,
  Subscription,
  User,
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

export async function cafesCollection(): Promise<Collection<Cafe>> {
  return (await getDb()).collection<Cafe>("cafes");
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

/**
 * Indexes the app relies on. Idempotent — safe to call from a setup script
 * or admin route after provisioning a new database.
 */
export async function ensureIndexes(): Promise<void> {
  const [users, locations, preferences, subscriptions, orders, deliveries, signals] =
    await Promise.all([
      usersCollection(),
      locationsCollection(),
      preferencesCollection(),
      subscriptionsCollection(),
      ordersCollection(),
      deliveriesCollection(),
      preferenceSignalsCollection(),
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
    orders.createIndex({ cafeId: 1, date: 1 }),
    orders.createIndex({ status: 1, cutoffAt: 1 }),
    deliveries.createIndex({ orderId: 1 }, { unique: true }),
    signals.createIndex({ userId: 1, date: 1 }),
  ]);
}
