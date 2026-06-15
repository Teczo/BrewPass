import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSubscription, getOrCreateStripeCustomer } from "@/lib/billing";
import { requireEnv } from "@/lib/env";
import { PLANS } from "@/lib/plans";
import { getStripe } from "@/lib/stripe";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const checkoutInputSchema = z.object({
  plan: z.enum(["lite", "weekday", "premium", "student"]),
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

  // The student plan is locked behind admin verification.
  if (parsed.data.plan === "student" && !user.studentVerifiedAt) {
    return NextResponse.json(
      {
        error: "The student plan needs verification first — contact support with your student ID.",
      },
      { status: 403 },
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
  const customerId = await getOrCreateStripeCustomer(user);

  const baseUrl = requireEnv("APP_BASE_URL");
  // Phase E: save the card via a SetupIntent — no upfront/recurring charge
  // (critical rule #3). The membership is activated from the
  // checkout.session.completed webhook; coffee is charged per-day at cutoff.
  const session = await getStripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    currency: "myr",
    success_url: `${baseUrl}/dashboard/billing?success=1`,
    cancel_url: `${baseUrl}/dashboard/billing?canceled=1`,
    metadata: { userId: user._id.toHexString(), plan: plan.plan, kind: "membership_setup" },
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
