import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { getOrCreateCompanyStripeCustomer } from "@/lib/billing";
import { corporateAccountsCollection } from "@/lib/collections";
import { requireEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

async function getOwnedAccount(userId: ObjectId) {
  const accounts = await corporateAccountsCollection();
  return accounts.findOne({ billingOwnerUserId: userId });
}

/** Whether the company card is on file (for the owner UI). */
export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  return NextResponse.json({ cardOnFile: Boolean(account.companyStripePaymentMethodId) });
}

/**
 * Phase J.7 — save the company card via a SetupIntent Checkout (no upfront
 * charge, rule #3). Office coffee is charged to this card per-day at cutoff.
 * The card is persisted from the checkout.session.completed webhook
 * (kind = company_card_setup).
 */
export async function POST() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const customerId = await getOrCreateCompanyStripeCustomer(account);
  const baseUrl = requireEnv("APP_BASE_URL");

  const session = await getStripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    currency: "myr",
    success_url: `${baseUrl}/dashboard/corporate?card=1`,
    cancel_url: `${baseUrl}/dashboard/corporate?card_canceled=1`,
    metadata: {
      corporateAccountId: account._id.toHexString(),
      kind: "company_card_setup",
    },
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
