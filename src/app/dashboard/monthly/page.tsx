import Link from "next/link";
import { redirect } from "next/navigation";

import { MonthlyListPlanner } from "@/components/monthly-list-planner";
import { getCurrentSubscription } from "@/lib/billing";
import {
  locationsCollection,
  monthlyListsCollection,
  preferencesCollection,
} from "@/lib/collections";
import { periodOf, vendorNamesForList } from "@/lib/monthly-list/service";
import { personalPreferenceFilter } from "@/lib/preferences";
import { monthlyListToJson } from "@/lib/serializers";
import { drinkOptionsFrom, loadActiveTaxonomy } from "@/lib/taxonomy";
import { DEFAULT_DRINK_OPTIONS } from "@/lib/taxonomy-options";
import { localDateOf } from "@/lib/time";
import { getOnboardingStatus, getOrCreateCurrentUser } from "@/lib/users";
import { loadVendorCardsForUser } from "@/lib/vendor-selection";

export const dynamic = "force-dynamic";

export default async function MonthlyListPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/dashboard/monthly");
  if (user.role === "cafe" || user.role === "vendor") redirect("/vendor");

  const status = await getOnboardingStatus(user);
  if (!status.completed) redirect("/onboarding");

  const period = periodOf(localDateOf(new Date()));

  const [preferences, locations, monthlyLists] = await Promise.all([
    preferencesCollection(),
    locationsCollection(),
    monthlyListsCollection(),
  ]);
  const [preference, subscription, listDoc] = await Promise.all([
    preferences.findOne(personalPreferenceFilter(user._id)),
    getCurrentSubscription(user._id),
    monthlyLists.findOne({ userId: user._id, period }),
  ]);

  const location = preference
    ? await locations.findOne({ _id: preference.defaultLocationId, userId: user._id })
    : null;

  const vendors =
    preference && location
      ? await loadVendorCardsForUser(location.geo, {
          drink: preference.defaultDrink.drink,
          milk: preference.defaultDrink.milk,
        })
      : [];

  const initialList = listDoc
    ? monthlyListToJson(listDoc, await vendorNamesForList(listDoc))
    : null;
  const drinkOptions = (drinkOptionsFrom(await loadActiveTaxonomy()) ?? DEFAULT_DRINK_OPTIONS)
    .drinks;

  const hasLiveSubscription = subscription !== null && subscription.status !== "canceled";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your month of coffee ☕</h1>
          <p className="text-sm text-neutral-500">Choose once. We handle every morning.</p>
        </div>
        <Link href="/dashboard" className="text-sm text-amber-800 hover:underline">
          ← Dashboard
        </Link>
      </header>

      {!hasLiveSubscription ? (
        <section className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <p className="text-sm">Add your card to build your monthly list.</p>
          <Link
            href="/dashboard/billing"
            className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            Add your card
          </Link>
        </section>
      ) : !preference || !location ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Set your usual drink and a default delivery location first, then come back to plan your
          month.{" "}
          <Link href="/onboarding/preferences" className="font-medium underline">
            Set preferences
          </Link>
        </section>
      ) : (
        <MonthlyListPlanner
          period={period}
          initialList={initialList}
          vendors={vendors}
          drinkOptions={drinkOptions}
        />
      )}
    </main>
  );
}
