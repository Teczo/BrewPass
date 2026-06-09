import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSubscription, getOrCreateStripeCustomer, resolvePriceId } from "@/lib/billing";
import { requireEnv } from "@/lib/env";
import { PLANS } from "@/lib/plans";
import { getStripe } from "@/lib/stripe";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const checkoutInputSchema = z.object({
  plan: z.enum(["lite", "weekday", "premium"]),
});

export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = checkoutInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = await getCurrentSubscription(user._id);
  if (existing && existing.status !== "canceled") {
    return NextResponse.json(
      { error: "You already have a subscription. Manage it from the billing page." },
      { status: 409 },
    );
  }

  const plan = PLANS[parsed.data.plan];
  const [customerId, priceId] = await Promise.all([
    getOrCreateStripeCustomer(user),
    resolvePriceId(plan),
  ]);

  const baseUrl = requireEnv("APP_BASE_URL");
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/dashboard/billing?success=1`,
    cancel_url: `${baseUrl}/dashboard/billing?canceled=1`,
    subscription_data: {
      metadata: { userId: user._id.toHexString(), plan: plan.plan },
    },
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
