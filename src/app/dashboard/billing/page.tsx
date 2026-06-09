import Link from "next/link";
import { redirect } from "next/navigation";

import { PlanPicker } from "@/components/plan-picker";
import { SubscriptionPanel } from "@/components/subscription-panel";
import { getCurrentSubscription } from "@/lib/billing";
import { formatMyr } from "@/lib/format";
import { PLANS, PLAN_LIST } from "@/lib/plans";
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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
          <p className="text-sm text-neutral-500">Your BrewPass plan and payments.</p>
        </div>
        <Link href="/dashboard" className="text-sm text-amber-800 hover:underline">
          ← Dashboard
        </Link>
      </header>

      {params.success && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Subscription confirmed — welcome aboard! Your daily coffees start once order scheduling
          launches.
        </p>
      )}
      {params.canceled && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Checkout canceled — no charge was made.
        </p>
      )}

      {hasLiveSubscription ? (
        <SubscriptionPanel
          subscription={subscriptionToJson(subscription)}
          planName={PLANS[subscription.plan].name}
        />
      ) : (
        <>
          {subscription?.status === "canceled" && (
            <p className="text-sm text-neutral-500">
              Your previous plan was canceled. Pick a plan to come back any time.
            </p>
          )}
          <PlanPicker
            plans={PLAN_LIST.map((plan) => ({
              plan: plan.plan,
              name: plan.name,
              priceLabel: formatMyr(plan.priceSen),
              quota: plan.quota,
              description: plan.description,
            }))}
          />
        </>
      )}
    </main>
  );
}
