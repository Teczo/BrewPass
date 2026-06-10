import { NextResponse } from "next/server";
import { z } from "zod";

import { syncCorporateSubscriptionFromStripe } from "@/lib/billing";
import { corporateAccountsCollection } from "@/lib/collections";
import { getStripe } from "@/lib/stripe";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const seatsSchema = z.object({ seats: z.number().int().min(1).max(500) });

/** Change the seat count — updates the Stripe quantity (prorated) and
 * re-syncs the account from the returned subscription. */
export async function PATCH(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accounts = await corporateAccountsCollection();
  const account = await accounts.findOne({ billingOwnerUserId: user._id });
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });
  if (!account.stripeSubscriptionId || account.status === "canceled") {
    return NextResponse.json({ error: "No active company subscription." }, { status: 409 });
  }

  const parsed = seatsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  if (parsed.data.seats < account.memberUserIds.length) {
    return NextResponse.json(
      { error: `You have ${account.memberUserIds.length} members — remove some first.` },
      { status: 409 },
    );
  }

  const stripe = getStripe();
  const current = await stripe.subscriptions.retrieve(account.stripeSubscriptionId);
  const item = current.items.data[0];
  const updated = await stripe.subscriptions.update(account.stripeSubscriptionId, {
    items: [{ id: item.id, quantity: parsed.data.seats }],
    proration_behavior: "create_prorations",
  });
  await syncCorporateSubscriptionFromStripe(updated);

  return NextResponse.json({ ok: true, seats: parsed.data.seats });
}
