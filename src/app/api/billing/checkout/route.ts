import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSubscription, getOrCreateStripeCustomer } from "@/lib/billing";
import { requireEnv } from "@/lib/env";
import { DEFAULT_INDIVIDUAL_PLAN } from "@/lib/plans";
import { getStripe } from "@/lib/stripe";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

// No plan choice — an individual just saves a card. `returnTo` picks where
// Stripe sends the user back (onboarding step vs the billing page).
const checkoutInputSchema = z.object({
  returnTo: z.enum(["onboarding", "billing"]).optional(),
});

export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = checkoutInputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = await getCurrentSubscription(user._id);
  const cardOnFile = existing?.billingMode === "card_on_file";
  // A live card-on-file membership can re-run checkout to replace the card; a
  // legacy/active priced subscription is managed from the billing page instead.
  if (existing && existing.status !== "canceled" && !cardOnFile) {
    return NextResponse.json(
      { error: "You already have a subscription. Manage it from the billing page." },
      { status: 409 },
    );
  }

  const plan = DEFAULT_INDIVIDUAL_PLAN;
  const customerId = await getOrCreateStripeCustomer(user);

  const baseUrl = requireEnv("APP_BASE_URL");
  const returnPath =
    parsed.data.returnTo === "onboarding" ? "/onboarding/payment" : "/dashboard/billing";
  // Phase E: save the card via a SetupIntent — no upfront/recurring charge
  // (critical rule #3). The membership is activated from the
  // checkout.session.completed webhook; coffee is charged per-day at cutoff.
  const session = await getStripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    currency: "myr",
    success_url: `${baseUrl}${returnPath}?success=1`,
    cancel_url: `${baseUrl}${returnPath}?canceled=1`,
    metadata: { userId: user._id.toHexString(), plan: plan.plan, kind: "membership_setup" },
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
