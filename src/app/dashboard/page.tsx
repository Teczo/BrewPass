import Link from "next/link";
import { redirect } from "next/navigation";

import { HealthCard } from "@/components/health-card";
import { UpcomingOrder } from "@/components/upcoming-order";
import { ADD_ON_LIST } from "@/lib/addons";
import { getCurrentSubscription } from "@/lib/billing";
import { locationsCollection, ordersCollection, preferencesCollection } from "@/lib/collections";
import { formatMyr } from "@/lib/format";
import { summarizeHealth } from "@/lib/health";
import { PLANS } from "@/lib/plans";
import { locationToJson, orderToJson } from "@/lib/serializers";
import { drinkOptionsFrom, loadActiveTaxonomy } from "@/lib/taxonomy";
import { DEFAULT_DRINK_OPTIONS } from "@/lib/taxonomy-options";
import { addDaysLocal, localDateOf } from "@/lib/time";
import { getOnboardingStatus, getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

const WEEKDAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ORDER_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  preparing: "Preparing",
  out_for_delivery: "On its way",
  delivered: "Delivered",
  skipped: "Skipped",
  failed: "Failed",
};

export default async function DashboardPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/dashboard");
  if (user.role === "cafe" || user.role === "vendor") redirect("/vendor");

  const status = await getOnboardingStatus(user);
  if (!status.completed) redirect("/onboarding");

  const [locations, preferences, orders] = await Promise.all([
    locationsCollection(),
    preferencesCollection(),
    ordersCollection(),
  ]);
  const today = localDateOf(new Date());
  const [locationDocs, preference, subscription, upcomingOrder, recentOrders] = await Promise.all([
    locations.find({ userId: user._id }).sort({ createdAt: 1 }).toArray(),
    preferences.findOne({ userId: user._id }),
    getCurrentSubscription(user._id),
    orders.findOne({ userId: user._id, date: { $gte: today } }, { sort: { date: 1 } }),
    orders
      .find({ userId: user._id, date: { $lt: today } })
      .sort({ date: -1 })
      .limit(5)
      .toArray(),
  ]);
  const hasLiveSubscription = subscription !== null && subscription.status !== "canceled";

  const defaultLocation = preference
    ? locationDocs.find((location) => location._id.equals(preference.defaultLocationId))
    : undefined;

  // Opt-in health insights: consumed coffees over the last 7 KL days.
  const healthSummary = user.healthOptInAt
    ? summarizeHealth(
        (
          await orders
            .find({
              userId: user._id,
              date: { $gte: addDaysLocal(today, -7), $lt: today },
              status: { $in: ["confirmed", "preparing", "out_for_delivery", "delivered"] },
            })
            .toArray()
        ).map((order) => order.drink),
        7,
      )
    : null;

  // Add-ons are personal-card purchases — hidden for corporate seats.
  const addOnOptions =
    hasLiveSubscription && subscription.plan !== "corporate"
      ? ADD_ON_LIST.map((addOn) => ({
          key: addOn.key,
          name: addOn.name,
          priceLabel: formatMyr(addOn.priceSen),
        }))
      : [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hi, {user.name.split(" ")[0]} ☕</h1>
          <p className="text-sm text-neutral-500">
            {user.email} · {user.role}
          </p>
        </div>
        <a href="/auth/logout" className="text-sm text-neutral-500 hover:underline">
          Log out
        </a>
      </header>

      {hasLiveSubscription ? (
        <section className="flex items-center justify-between rounded-md border border-neutral-200 p-4">
          <div>
            <h2 className="font-semibold">BrewPass {PLANS[subscription.plan].name}</h2>
            <p className="text-sm text-neutral-500">
              {subscription.status === "paused" ? "Paused" : "Active"} ·{" "}
              {Math.max(0, subscription.quota.total - subscription.quota.used)} of{" "}
              {subscription.quota.total} coffees left this period
            </p>
          </div>
          <Link href="/dashboard/billing" className="text-sm text-amber-800 hover:underline">
            Manage
          </Link>
        </section>
      ) : (
        <section className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div>
            <p className="font-medium">No active plan yet.</p>
            <p className="text-sm">Pick a plan and your daily coffee is sorted.</p>
          </div>
          <Link
            href="/dashboard/billing"
            className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            See plans
          </Link>
        </section>
      )}

      {upcomingOrder && (
        <UpcomingOrder
          order={orderToJson(upcomingOrder)}
          locations={locationDocs.map(locationToJson)}
          addOnOptions={addOnOptions}
          drinkOptions={drinkOptionsFrom(await loadActiveTaxonomy()) ?? DEFAULT_DRINK_OPTIONS}
        />
      )}

      <HealthCard optedIn={Boolean(user.healthOptInAt)} summary={healthSummary} />

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-md border border-neutral-200 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Your usual</h2>
            <Link href="/onboarding/preferences" className="text-sm text-amber-800 hover:underline">
              Edit
            </Link>
          </div>
          {preference ? (
            <div className="mt-2 text-sm text-neutral-600">
              <p className="text-lg font-medium text-neutral-900">
                {preference.defaultDrink.drink}
              </p>
              <p>
                {preference.defaultDrink.size} · {preference.defaultDrink.milk} ·{" "}
                {preference.defaultDrink.sugar === 0
                  ? "no sugar"
                  : `sugar ${preference.defaultDrink.sugar}`}{" "}
                · {preference.defaultDrink.strength}
              </p>
              <p className="mt-2">
                {preference.schedule.days.map((day) => WEEKDAY_LABELS[day]).join(", ")} at{" "}
                {preference.schedule.time}
              </p>
              {defaultLocation && <p>Delivered to {defaultLocation.label}</p>}
              <Link
                href="/dashboard/vendor"
                className="mt-2 inline-block text-amber-800 hover:underline"
              >
                Choose your vendor →
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">Not set yet.</p>
          )}
        </section>

        <section className="rounded-md border border-neutral-200 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Locations</h2>
            <Link href="/onboarding/locations" className="text-sm text-amber-800 hover:underline">
              Manage
            </Link>
          </div>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-neutral-600">
            {locationDocs.map((location) => (
              <li key={location._id.toHexString()}>
                <span className="font-medium text-neutral-900">{location.label}</span> —{" "}
                {location.address}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {recentOrders.length > 0 && (
        <section className="rounded-md border border-neutral-200 p-4">
          <h2 className="font-semibold">Recent orders</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-neutral-600">
            {recentOrders.map((order) => (
              <li key={order._id.toHexString()} className="flex items-center justify-between">
                <span>
                  {order.date} — {order.drink.drink} to {order.location.label}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    order.status === "delivered"
                      ? "bg-green-100 text-green-800"
                      : order.status === "failed"
                        ? "bg-red-100 text-red-700"
                        : order.status === "skipped"
                          ? "bg-neutral-100 text-neutral-500"
                          : "bg-amber-100 text-amber-900"
                  }`}
                >
                  {ORDER_STATUS_LABELS[order.status] ?? order.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-md border border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Profile</h2>
          <Link href="/onboarding" className="text-sm text-amber-800 hover:underline">
            Edit
          </Link>
        </div>
        <p className="mt-2 text-sm text-neutral-600">
          {user.name} · {user.phone ?? "no phone"} · {user.role}
        </p>
      </section>
    </main>
  );
}
