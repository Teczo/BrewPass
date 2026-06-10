import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSubscription, syncSubscriptionFromStripe } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const manageInputSchema = z.object({
  action: z.enum(["pause", "resume", "cancel", "reactivate"]),
});

/**
 * Subscription lifecycle actions. Stripe is the source of truth: we mutate
 * there, then sync our record from the returned object (webhooks confirm
 * later — sync is idempotent either way).
 */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = manageInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const subscription = await getCurrentSubscription(user._id);
  if (!subscription || subscription.status === "canceled") {
    return NextResponse.json({ error: "No active subscription" }, { status: 404 });
  }
  // Corporate seats hang off the company's single Stripe subscription.
  if (subscription.plan === "corporate") {
    return NextResponse.json(
      { error: "Your plan is managed by your company's billing owner." },
      { status: 409 },
    );
  }

  const stripe = getStripe();
  const id = subscription.stripeSubscriptionId;
  let updated;
  switch (parsed.data.action) {
    case "pause":
      // Void invoices while paused — no charges, no deliveries.
      updated = await stripe.subscriptions.update(id, {
        pause_collection: { behavior: "void" },
      });
      break;
    case "resume":
      updated = await stripe.subscriptions.update(id, { pause_collection: "" });
      break;
    case "cancel":
      // Keep access until the period the user already paid for ends.
      updated = await stripe.subscriptions.update(id, { cancel_at_period_end: true });
      break;
    case "reactivate":
      updated = await stripe.subscriptions.update(id, { cancel_at_period_end: false });
      break;
  }

  const synced = await syncSubscriptionFromStripe(updated);
  return NextResponse.json({
    subscription: synced
      ? {
          plan: synced.plan,
          status: synced.status,
          cancelAtPeriodEnd: synced.cancelAtPeriodEnd,
        }
      : null,
  });
}
