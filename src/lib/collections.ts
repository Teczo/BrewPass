import { Collection } from "mongodb";

import { getDb } from "@/lib/db";
import type {
  CommissionConfig,
  CorporateAccount,
  CorporateJoinCode,
  CorporateMembership,
  Delivery,
  Location,
  OptionTaxonomy,
  MonthlyList,
  Order,
  Preference,
  PreferenceSignal,
  Rating,
  PackPurchase,
  Subscription,
  User,
  Vendor,
  VendorMenuDraft,
  VendorMenuItem,
  VendorPayout,
  VendorPromotion,
  WebhookDelivery,
  WebhookEvent,
  WebhookSubscription,
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

export async function vendorPromotionsCollection(): Promise<Collection<VendorPromotion>> {
  return (await getDb()).collection<VendorPromotion>("vendorPromotions");
}

export async function packPurchasesCollection(): Promise<Collection<PackPurchase>> {
  return (await getDb()).collection<PackPurchase>("packPurchases");
}

export async function corporateAccountsCollection(): Promise<Collection<CorporateAccount>> {
  return (await getDb()).collection<CorporateAccount>("corporateAccounts");
}

export async function corporateMembershipsCollection(): Promise<Collection<CorporateMembership>> {
  return (await getDb()).collection<CorporateMembership>("corporateMemberships");
}

export async function corporateJoinCodesCollection(): Promise<Collection<CorporateJoinCode>> {
  return (await getDb()).collection<CorporateJoinCode>("corporateJoinCodes");
}

export async function preferenceSignalsCollection(): Promise<Collection<PreferenceSignal>> {
  return (await getDb()).collection<PreferenceSignal>("preferenceSignals");
}

export async function webhookEventsCollection(): Promise<Collection<WebhookEvent>> {
  return (await getDb()).collection<WebhookEvent>("webhookEvents");
}

export async function webhookSubscriptionsCollection(): Promise<Collection<WebhookSubscription>> {
  return (await getDb()).collection<WebhookSubscription>("webhookSubscriptions");
}

export async function webhookDeliveriesCollection(): Promise<Collection<WebhookDelivery>> {
  return (await getDb()).collection<WebhookDelivery>("webhookDeliveries");
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
    webhookSubscriptions,
    webhookDeliveries,
    corporateMemberships,
    corporateJoinCodes,
    vendorPromotions,
    packPurchases,
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
    webhookSubscriptionsCollection(),
    webhookDeliveriesCollection(),
    corporateMembershipsCollection(),
    corporateJoinCodesCollection(),
    vendorPromotionsCollection(),
    packPurchasesCollection(),
  ]);

  await Promise.all([
    users.createIndex({ authSub: 1 }, { unique: true }),
    locations.createIndex({ userId: 1 }),
    // Phase J.2 — one preference per (user, scope): a personal preference plus
    // a separate office preference per corporate membership.
    preferences.createIndex({ userId: 1, scope: 1 }, { unique: true }),
    subscriptions.createIndex({ userId: 1 }),
    subscriptions.createIndex({ stripeSubscriptionId: 1 }, { unique: true }),
    // Idempotency: one order per (user, date, source) — the cron can never
    // double-generate (critical rule #1). Source lets a member hold a personal
    // and an office order on the same day (Phase J, rule #17).
    orders.createIndex({ userId: 1, date: 1, source: 1 }, { unique: true }),
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
    // Outbound webhooks (Phase I.5): the dispatcher lists active subscriptions.
    webhookSubscriptions.createIndex({ active: 1 }),
    // Idempotent outbound delivery: one row per (subscription, logical event).
    webhookDeliveries.createIndex({ subscriptionId: 1, eventId: 1 }, { unique: true }),
    // The retry sweep claims due, non-terminal deliveries.
    webhookDeliveries.createIndex({ status: 1, nextAttemptAt: 1 }),
    // Phase I.2 — stable external identity. Unique per collection; partial so
    // any rows not yet backfilled (missing externalId) don't collide on null.
    // The API boundary looks entities up by externalId, never raw _id.
    users.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    locations.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    preferences.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    subscriptions.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    orders.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    vendors.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    monthlyLists.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    vendorPayouts.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    ratings.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    taxonomy.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    menuItems.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    menuDrafts.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    deliveries.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    signals.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    webhookSubscriptions.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    // Phase J.0 — corporate membership is the source of truth for "user X
    // belongs to company Y". One membership per (account, user); the migration
    // and the member-add flow upsert on this key (idempotent).
    corporateMemberships.createIndex({ corporateAccountId: 1, userId: 1 }, { unique: true }),
    // Resolve every company a given user belongs to (a user may hold more than
    // one membership across companies, plus their untouched personal account).
    corporateMemberships.createIndex({ userId: 1 }),
    corporateMemberships.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    // Phase J.1 — join codes. Redemption looks a code up directly, so it is
    // globally unique; the owner's portal lists a company's codes by account.
    corporateJoinCodes.createIndex({ code: 1 }, { unique: true }),
    corporateJoinCodes.createIndex({ corporateAccountId: 1 }),
    corporateJoinCodes.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    // Phase K.1 — vendor promotions. The portal lists a vendor's promos; the
    // admin discovers active ones (status + validity window).
    vendorPromotions.createIndex({ vendorId: 1 }),
    vendorPromotions.createIndex({ status: 1, type: 1, validFrom: 1, validUntil: 1 }),
    vendorPromotions.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
    // Phase K.1 — pack purchases. At most one per (company, date); buying upserts
    // on this key. Generation/cutoff look up a date's purchases.
    packPurchases.createIndex({ corporateAccountId: 1, date: 1 }, { unique: true }),
    packPurchases.createIndex({ status: 1, date: 1 }),
    packPurchases.createIndex(
      { externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $exists: true } } },
    ),
  ]);
}
