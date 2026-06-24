import Link from "next/link";
import { redirect } from "next/navigation";

import { SaveCardButton } from "@/components/save-card-button";
import { SubscriptionPanel } from "@/components/subscription-panel";
import { getCurrentSubscription } from "@/lib/billing";
import { PLANS } from "@/lib/plans";
import { subscriptionToJson } from "@/lib/serializers";
import { getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/dashboard/billing");

  const [params, subscription] = await Promise.all([
    searchParams,
    getCurrentSubscription(user._id),
  ]);
  const hasLiveSubscription = subscription !== null && subscription.status !== "canceled";
  const cardOnFile = hasLiveSubscription && subscription.billingMode === "card_on_file";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payment</h1>
          <p className="text-sm text-neutral-500">
            Your card on file. No subscription fee — coffee is charged per day at cutoff.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-amber-800 hover:underline">
          ← Dashboard
        </Link>
      </header>

      {params.success && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Card saved — you&apos;re all set. Coffee is charged only on the days you get one.
        </p>
      )}
      {params.canceled && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Card setup canceled — no card was saved.
        </p>
      )}

      {hasLiveSubscription ? (
        <>
          <SubscriptionPanel
            subscription={subscriptionToJson(subscription)}
            planName={PLANS[subscription.plan].name}
            manageable={subscription.plan !== "corporate"}
          />
          {cardOnFile && (
            <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4">
              <h2 className="font-semibold">Card on file</h2>
              <p className="text-sm text-neutral-500">
                Need to update the card we charge for your daily coffee?
              </p>
              <SaveCardButton
                returnTo="billing"
                label="Replace card"
                className="self-start rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
              />
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-neutral-200 p-5">
          <h2 className="font-semibold">Add your card to start</h2>
          <p className="text-sm text-neutral-500">
            {subscription?.status === "canceled"
              ? "Your coffee is stopped. Save a card to start again — "
              : "No charge today and no monthly fee. We save your card and charge it only for the coffee you get, "}
            each day at that day&apos;s cutoff. Your schedule decides which days.
          </p>
          <SaveCardButton returnTo="billing" label="Save my card" />
        </div>
      )}

      <p className="text-sm text-neutral-500">
        Setting up coffee for a team?{" "}
        <Link href="/dashboard/corporate" className="text-amber-800 hover:underline">
          Run office coffee
        </Link>{" "}
        — billed per delivered coffee on one company card, no seats.
      </p>
    </main>
  );
}
