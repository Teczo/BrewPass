import Link from "next/link";
import { redirect } from "next/navigation";

import { DeliveryTracker } from "@/components/delivery-tracker";
import { OverlapNotice } from "@/components/overlap-notice";
import { RateOrder } from "@/components/rate-order";
import { buttonClasses } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { UpcomingOrder } from "@/components/upcoming-order";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Notice } from "@/components/ui/notice";
import { ADD_ON_LIST } from "@/lib/addons";
import { getCurrentSubscription } from "@/lib/billing";
import { findUserOverlaps } from "@/lib/corporate/overlap";
import { hasCoverageForAnyPoint } from "@/lib/launch-waitlist";
import { locationsCollection, ordersCollection, ratingsCollection } from "@/lib/collections";
import { formatMyr } from "@/lib/format";
import { locationToJson, orderToJson } from "@/lib/serializers";
import { drinkOptionsFrom, loadActiveTaxonomy } from "@/lib/taxonomy";
import { DEFAULT_DRINK_OPTIONS } from "@/lib/taxonomy-options";
import { localDateOf } from "@/lib/time";
import { getOnboardingStatus, getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

const ORDER_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  preparing: "Preparing",
  out_for_delivery: "On its way",
  delivered: "Delivered",
  skipped: "Skipped",
  failed: "Failed",
};

const ORDER_STATUS_TONES: Record<string, StatusTone> = {
  scheduled: "scheduled",
  confirmed: "scheduled",
  preparing: "preparing",
  out_for_delivery: "preparing",
  delivered: "delivered",
  skipped: "skipped",
  failed: "failed",
};

function formatDeliveryDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function DashboardPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/dashboard");
  if (user.role === "cafe" || user.role === "vendor") redirect("/vendor");

  const status = await getOnboardingStatus(user);
  if (!status.completed) redirect("/onboarding");

  const [locations, orders, ratings] = await Promise.all([
    locationsCollection(),
    ordersCollection(),
    ratingsCollection(),
  ]);
  const today = localDateOf(new Date());
  const [locationDocs, subscription, upcomingOrder, recentOrders] = await Promise.all([
    locations.find({ userId: user._id }).sort({ createdAt: 1 }).toArray(),
    getCurrentSubscription(user._id),
    orders.findOne({ userId: user._id, date: { $gte: today } }, { sort: { date: 1 } }),
    orders
      .find({ userId: user._id, date: { $lt: today } })
      .sort({ date: -1 })
      .limit(5)
      .toArray(),
  ]);
  const hasLiveSubscription = subscription !== null && subscription.status !== "canceled";

  // Phase O.1 cold-start (fallbacks.md §1.1/§1.2): if no active vendor covers
  // any of the user's delivery points, they're in a coverage gap — show a
  // launching-soon banner + sample slot rather than a real order. Driven live so
  // a brand-new user sees the right state on day one; the nightly cron records
  // their waitlist entry and emails them once a vendor goes live.
  const inCoverageGap =
    !upcomingOrder && !(await hasCoverageForAnyPoint(locationDocs.map((loc) => loc.geo)));
  const waitlistAddress = locationDocs[0]?.address;

  // Phase J.5: advisory same-day personal/office overlap notice. Only shown
  // until the member sets a standing rule (then overlaps reconcile silently at
  // generation) — keeping the "user does nothing daily" promise (rule #17).
  const overlaps = user.overlapRule ? [] : await findUserOverlaps(user._id, new Date());

  // Phase G: which recent orders the user has already rated (to show stars).
  const ratingByOrderId = new Map(
    (
      await ratings.find({ orderId: { $in: recentOrders.map((order) => order._id) } }).toArray()
    ).map((rating) => [rating.orderId.toHexString(), rating.score]),
  );

  // Add-ons are personal-card purchases — hidden for corporate seats.
  const addOnOptions =
    hasLiveSubscription && subscription.plan !== "corporate"
      ? ADD_ON_LIST.map((addOn) => ({
          key: addOn.key,
          name: addOn.name,
          priceLabel: formatMyr(addOn.priceSen),
        }))
      : [];

  const firstName = user.name.split(" ")[0];
  const coffeesLeft = hasLiveSubscription
    ? Math.max(0, subscription.quota.total - subscription.quota.used)
    : 0;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-espresso font-display text-lg text-white">
            {firstName.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="font-display text-2xl leading-tight text-espresso">
              Hi, {firstName}
            </h1>
            <p className="text-xs text-muted">{user.email}</p>
          </div>
        </div>
        <a href="/auth/logout" className="text-sm font-semibold text-coffee hover:underline">
          Log out
        </a>
      </header>

      {hasLiveSubscription ? (
        <Card className="flex items-center justify-between gap-3 p-5">
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Weekday plan</SectionLabel>
            <div className="flex items-center gap-2">
              <StatusPill tone={subscription.status === "paused" ? "skipped" : "active"}>
                {subscription.status === "paused" ? "Paused" : "Active"}
              </StatusPill>
            </div>
            <p className="text-sm text-coffee">
              {subscription.billingMode === "card_on_file"
                ? "Charged per coffee · no monthly fee"
                : `${coffeesLeft} of ${subscription.quota.total} coffees left`}
            </p>
          </div>
          <Link href="/dashboard/billing" className={buttonClasses("outline")}>
            Manage
          </Link>
        </Card>
      ) : (
        <Card className="flex items-center justify-between gap-3 p-5">
          <div>
            <p className="font-semibold text-espresso">No card on file yet.</p>
            <p className="text-sm text-coffee">Add your card and your daily coffee is sorted.</p>
          </div>
          <Link href="/dashboard/billing" className={buttonClasses("primary")}>
            Add card
          </Link>
        </Card>
      )}

      {overlaps.length > 0 && (
        <ErrorBoundary label="your coffee overlap notice">
          <OverlapNotice overlaps={overlaps} />
        </ErrorBoundary>
      )}

      {inCoverageGap && (
        <>
          <Notice icon="☕">
            {waitlistAddress
              ? `No vendors deliver to ${waitlistAddress} yet — we'll email you the day your first vendor goes live.`
              : "We're launching in your area soon — we'll email you the day your first vendor goes live."}
          </Notice>
          <Card className="flex flex-col items-center gap-2 p-8 text-center">
            <span className="text-4xl" aria-hidden>
              ☕
            </span>
            <p className="font-display text-lg text-espresso">Your daily coffee starts here</p>
            <p className="text-sm text-coffee">
              Once a café near you goes live, tomorrow&apos;s coffee will appear in this spot — no
              daily taps needed.
            </p>
          </Card>
        </>
      )}

      {upcomingOrder && (
        <ErrorBoundary label="your upcoming coffee">
          <UpcomingOrder
            order={orderToJson(upcomingOrder)}
            locations={locationDocs.map(locationToJson)}
            addOnOptions={addOnOptions}
            drinkOptions={drinkOptionsFrom(await loadActiveTaxonomy()) ?? DEFAULT_DRINK_OPTIONS}
          />
        </ErrorBoundary>
      )}

      {upcomingOrder?.status === "out_for_delivery" && (
        <ErrorBoundary label="delivery tracking">
          <DeliveryTracker orderId={upcomingOrder._id.toHexString()} />
        </ErrorBoundary>
      )}

      {hasLiveSubscription && (
        <Card className="flex items-center justify-between gap-3 p-5">
          <div>
            <h2 className="font-semibold text-espresso">Plan your month</h2>
            <p className="text-sm text-coffee">
              Pick a coffee and vendor for every day at once, then confirm and forget.
            </p>
          </div>
          <Link href="/dashboard/monthly" className={buttonClasses("primary", "shrink-0")}>
            Plan →
          </Link>
        </Card>
      )}

      {recentOrders.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionLabel>Recent coffee deliveries</SectionLabel>
          <ul className="flex flex-col gap-3">
            {recentOrders.map((order) => (
              <Card
                as="li"
                key={order._id.toHexString()}
                className="flex items-center justify-between gap-3 p-4"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-espresso">{order.drink.drink}</span>
                  <span className="text-xs text-muted">{formatDeliveryDate(order.date)}</span>
                </div>
                <div className="flex items-center gap-3">
                  {order.status === "delivered" && (
                    <RateOrder
                      orderId={order._id.toHexString()}
                      initialScore={ratingByOrderId.get(order._id.toHexString())}
                    />
                  )}
                  <StatusPill tone={ORDER_STATUS_TONES[order.status] ?? "scheduled"}>
                    {ORDER_STATUS_LABELS[order.status] ?? order.status}
                  </StatusPill>
                </div>
              </Card>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
