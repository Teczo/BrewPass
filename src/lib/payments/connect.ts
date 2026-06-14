import { vendorsCollection } from "@/lib/collections";
import type { Vendor } from "@/lib/models";
import { getStripe } from "@/lib/stripe";

/**
 * Stripe Connect onboarding for vendors (Phase E). Vendors are Express
 * connected accounts — Stripe collects and holds all bank/KYC data; we never
 * store payout details ourselves (critical rule #9). We only keep the account
 * id and the charges/payouts-enabled flags (mirrored from `account.updated`).
 */

/** The connected account id for a vendor, creating the account on first use. */
export async function getOrCreateConnectAccount(vendor: Vendor): Promise<string> {
  if (vendor.stripeConnectAccountId) return vendor.stripeConnectAccountId;

  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: "express",
    country: "MY",
    business_type: "company",
    capabilities: { transfers: { requested: true } },
    metadata: { vendorId: vendor._id.toHexString() },
  });

  const vendors = await vendorsCollection();
  // Only claim the id if none was set meanwhile (guards a concurrent create).
  const updated = await vendors.findOneAndUpdate(
    { _id: vendor._id, stripeConnectAccountId: { $exists: false } },
    { $set: { stripeConnectAccountId: account.id, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) {
    const fresh = await vendors.findOne({ _id: vendor._id });
    if (fresh?.stripeConnectAccountId && fresh.stripeConnectAccountId !== account.id) {
      return fresh.stripeConnectAccountId;
    }
  }
  return account.id;
}

/** A Stripe-hosted onboarding link for the connected account. */
export async function createOnboardingLink(accountId: string, baseUrl: string): Promise<string> {
  const link = await getStripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${baseUrl}/vendor/profile?connect=refresh`,
    return_url: `${baseUrl}/vendor/profile?connect=done`,
  });
  return link.url;
}

export interface ConnectStatus {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

/**
 * Pull the live capability flags off a connected account and persist them on
 * the vendor. Called after onboarding and from the `account.updated` webhook,
 * so routing/payouts always read a current "can this vendor be paid?" flag.
 */
export async function syncConnectStatus(vendor: Vendor): Promise<ConnectStatus> {
  if (!vendor.stripeConnectAccountId) {
    return { accountId: null, chargesEnabled: false, payoutsEnabled: false };
  }
  const account = await getStripe().accounts.retrieve(vendor.stripeConnectAccountId);
  return applyAccountStatus(
    vendor.stripeConnectAccountId,
    Boolean(account.charges_enabled),
    Boolean(account.payouts_enabled),
  );
}

/** Persist Connect capability flags for the vendor owning `accountId`. */
export async function applyAccountStatus(
  accountId: string,
  chargesEnabled: boolean,
  payoutsEnabled: boolean,
): Promise<ConnectStatus> {
  const vendors = await vendorsCollection();
  await vendors.updateOne(
    { stripeConnectAccountId: accountId },
    {
      $set: {
        connectChargesEnabled: chargesEnabled,
        connectPayoutsEnabled: payoutsEnabled,
        updatedAt: new Date(),
      },
    },
  );
  return { accountId, chargesEnabled, payoutsEnabled };
}
