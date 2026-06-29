import Link from "next/link";
import { redirect } from "next/navigation";

import { SaveCardButton } from "@/components/save-card-button";
import { SubscriptionPanel } from "@/components/subscription-panel";
import { buttonClasses } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getCurrentSubscription } from "@/lib/billing";
import { ordersCollection } from "@/lib/collections";
import { formatMyr } from "@/lib/format";
import { PLANS } from "@/lib/plans";
import { subscriptionToJson } from "@/lib/serializers";
import { localDateOf } from "@/lib/time";
import { getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

function formatChargeDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/dashboard/billing");

  const today = localDateOf(new Date());
  const [params, subscription, orders] = await Promise.all([
    searchParams,
    getCurrentSubscription(user._id),
    ordersCollection(),
  ]);
  const recentOrders = await orders
    .find({ userId: user._id, date: { $lt: today } })
    .sort({ date: -1 })
    .limit(6)
    .toArray();
  const hasLiveSubscription = subscription !== null && subscription.status !== "canceled";
  const cardOnFile = hasLiveSubscription && subscription.billingMode === "card_on_file";

  // Per-coffee charge total = price snapshot + any successfully-charged add-ons.
  // Skipped/failed/refunded orders surface as RM0.00 (rule #1 auto-refund).
  const charges = recentOrders.map((order) => {
    const charged =
      order.status === "skipped" ||
      order.status === "failed" ||
      order.chargeStatus === "refunded" ||
      order.chargeStatus === "failed"
        ? 0
        : (order.priceSen ?? 0) +
          (order.addOnsPaymentStatus === "failed"
            ? 0
            : (order.addOns ?? []).reduce((sum, addOn) => sum + addOn.priceSen, 0));
    const addOnNames = (order.addOns ?? []).map((addOn) => addOn.name).join(", ");
    return {
      id: order._id.toHexString(),
      label: `${order.drink.drink}${addOnNames ? ` + ${addOnNames}` : ""}`,
      date: formatChargeDate(order.date),
      skipped: order.status === "skipped",
      amountSen: charged,
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[26px] leading-tight text-espresso">Payment</h1>
        <p className="text-sm text-coffee">
          No subscription fee — coffee is charged per day at cutoff.
        </p>
      </header>

      {params.success && (
        <Notice tone="sage" icon="✓">
          Card saved — you&apos;re all set. Coffee is charged only on the days you get one.
        </Notice>
      )}
      {params.canceled && (
        <Notice tone="amber" icon="⚠️">
          Card setup canceled — no card was saved.
        </Notice>
      )}

      {hasLiveSubscription ? (
        <>
          <SubscriptionPanel
            subscription={subscriptionToJson(subscription)}
            planName={PLANS[subscription.plan].name}
            manageable={subscription.plan !== "corporate"}
          />
          {cardOnFile && (
            <Card className="flex items-center justify-between gap-3 p-5">
              <div className="flex flex-col gap-0.5">
                <SectionLabel>Card on file</SectionLabel>
                <p className="text-sm text-coffee">Charged per coffee at cutoff</p>
              </div>
              <SaveCardButton
                returnTo="billing"
                label="Replace card"
                className={buttonClasses("secondary")}
              />
            </Card>
          )}
        </>
      ) : (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-semibold text-espresso">Add your card to start</h2>
          <p className="text-sm text-coffee">
            {subscription?.status === "canceled"
              ? "Your coffee is stopped. Save a card to start again — "
              : "No charge today and no monthly fee. We save your card and charge it only for the coffee you get, "}
            each day at that day&apos;s cutoff. Your schedule decides which days.
          </p>
          <SaveCardButton
            returnTo="billing"
            label="Save my card"
            className={buttonClasses("primary", "w-full")}
          />
        </Card>
      )}

      <Notice>
        Each weekday&apos;s coffee is charged silently at the{" "}
        <span className="font-mono font-semibold">6:00 AM</span> cutoff. Edit or skip before then.
      </Notice>

      {charges.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionLabel>Recent charges</SectionLabel>
          <ul className="flex flex-col gap-3">
            {charges.map((charge) => (
              <Card
                as="li"
                key={charge.id}
                className="flex items-center justify-between gap-3 p-4"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-espresso">{charge.label}</span>
                  <span className="text-xs text-muted">
                    {charge.date}
                    {charge.skipped && " · skipped"}
                  </span>
                </div>
                <span className="font-mono text-sm font-semibold text-espresso">
                  {formatMyr(charge.amountSen)}
                </span>
              </Card>
            ))}
          </ul>
        </section>
      )}

      <p className="text-sm text-coffee">
        Setting up coffee for a team?{" "}
        <Link href="/dashboard/corporate" className="font-semibold text-coffee underline">
          Run office coffee
        </Link>{" "}
        — billed per delivered coffee on one company card, no seats.
      </p>
    </main>
  );
}
