import { Collection } from "mongodb";

import { getDb } from "@/lib/db";
import type {
  CommissionConfig,
  CorporateAccount,
  Delivery,
  Location,
  OptionTaxonomy,
  MonthlyList,
  Order,
  Preference,
  PreferenceSignal,
  Rating,
  Subscription,
  User,
  Vendor,
  VendorMenuDraft,
  VendorMenuItem,
  VendorPayout,
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

export async function monthlyListsCollection(): Promise<Collection<MonthlyList>> {
  return (await getDb()).collection<MonthlyList>("monthlyLists");
}

export async function vendorPayoutsCollection(): Promise<Collection<VendorPayout>> {
  return (await getDb()).collection<VendorPayout>("vendorPayouts");
}

export async function commissionConfigCollection(): Promise<Collection<CommissionConfig>> {
  return (await getDb()).collection<CommissionConfig>("commissionConfig");
}

export async function ratingsCollection(): Promise<Collection<Rating>> {
  return (await getDb()).collection<Rating>("ratings");
}

export async function optionTaxonomyCollection(): Promise<Collection<OptionTaxonomy>> {
  return (await getDb()).collection<OptionTaxonomy>("optionTaxonomy");
}

export async function vendorMenuItemsCollection(): Promise<Collection<VendorMenuItem>> {
  return (await getDb()).collection<VendorMenuItem>("vendorMenuItems");
}

export async function vendorMenuDraftsCollection(): Promise<Collection<VendorMenuDraft>> {
  return (await getDb()).collection<VendorMenuDraft>("vendorMenuDrafts");
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
    monthlyLists,
    vendorPayouts,
    ratings,
    taxonomy,
    menuItems,
    menuDrafts,
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
    monthlyListsCollection(),
    vendorPayoutsCollection(),
    ratingsCollection(),
    optionTaxonomyCollection(),
    vendorMenuItemsCollection(),
    vendorMenuDraftsCollection(),
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
    // One monthly list per user per period; generation upserts on this key.
    monthlyLists.createIndex({ userId: 1, period: 1 }, { unique: true }),
    // Nightly generation looks up confirmed lists for a period to honour
    // skipped days.
    monthlyLists.createIndex({ status: 1, period: 1 }),
    // Portal login resolves the operator's vendor by membership.
    vendors.createIndex({ portalUserSubs: 1 }),
    // One vendor (application) per owning user; concurrent applies collide.
    vendors.createIndex(
      { ownerUserId: 1 },
      { unique: true, partialFilterExpression: { ownerUserId: { $exists: true } } },
    ),
    // One taxonomy entry per slug within a category; seed/migration upsert
    // on this key.
    taxonomy.createIndex({ category: 1, slug: 1 }, { unique: true }),
    // One menu item per (vendor, taxonomy slug); the menu editor upserts
    // on this key. Listing a vendor's whole menu uses the prefix.
    menuItems.createIndex({ vendorId: 1, taxonomySlug: 1 }, { unique: true }),
    // One AI-onboarding menu draft per vendor; extraction upserts on this key.
    menuDrafts.createIndex({ vendorId: 1 }, { unique: true }),
    // One rating per order (idempotent submit); vendor aggregation reads by
    // vendorId.
    ratings.createIndex({ orderId: 1 }, { unique: true }),
    ratings.createIndex({ vendorId: 1 }),
    // Vendor earnings/statement queries and the daily_batch sweep group by
    // vendor + period.
    vendorPayouts.createIndex({ vendorId: 1, period: 1 }),
    // Idempotent daily_batch sweep: at most one batch per vendor per period.
    vendorPayouts.createIndex(
      { vendorId: 1, period: 1, cadence: 1 },
      { unique: true, partialFilterExpression: { cadence: "daily_batch" } },
    ),
    deliveries.createIndex({ orderId: 1 }, { unique: true }),
    // Courier webhooks (v2.1) resolve the delivery by the provider's order ref.
    deliveries.createIndex(
      { courierOrderId: 1 },
      { partialFilterExpression: { courierOrderId: { $exists: true } } },
    ),
    signals.createIndex({ userId: 1, date: 1 }),
    // One preference signal per confirmed order.
    signals.createIndex({ orderId: 1 }, { unique: true }),
    // Webhook idempotency: each delivered event is claimed exactly once.
    webhooks.createIndex({ source: 1, eventId: 1 }, { unique: true }),
  ]);
}
