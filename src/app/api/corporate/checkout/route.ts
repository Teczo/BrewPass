import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateStripeCustomer, resolvePriceId } from "@/lib/billing";
import { corporateAccountsCollection } from "@/lib/collections";
import { requireEnv } from "@/lib/env";
import { PLANS } from "@/lib/plans";
import { getStripe } from "@/lib/stripe";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const checkoutSchema = z.object({ seats: z.number().int().min(1).max(500) });

/** Start the company subscription: one Stripe sub, quantity = seats. */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const accounts = await corporateAccountsCollection();
  const account = await accounts.findOne({ billingOwnerUserId: user._id });
  if (!account) {
    return NextResponse.json({ error: "Create your corporate account first." }, { status: 404 });
  }
  if (account.status && account.status !== "canceled") {
    return NextResponse.json(
      { error: "This company already has a subscription. Adjust seats instead." },
      { status: 409 },
    );
  }

  const [customerId, priceId] = await Promise.all([
    getOrCreateStripeCustomer(user),
    resolvePriceId(PLANS.corporate),
  ]);

  const baseUrl = requireEnv("APP_BASE_URL");
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: parsed.data.seats }],
    success_url: `${baseUrl}/dashboard/corporate?success=1`,
    cancel_url: `${baseUrl}/dashboard/corporate?canceled=1`,
    subscription_data: {
      metadata: { corporateAccountId: account._id.toHexString(), plan: "corporate" },
    },
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
