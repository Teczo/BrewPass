import Link from "next/link";
import { redirect } from "next/navigation";

import { MonthlyListPlanner } from "@/components/monthly-list-planner";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[26px] leading-tight text-espresso">Plan your month</h1>
        <p className="text-sm text-coffee">Choose once. We handle every morning.</p>
      </header>

      {!hasLiveSubscription ? (
        <Card className="flex items-center justify-between gap-3 p-5">
          <p className="text-sm text-coffee">Add your card to build your monthly list.</p>
          <Link href="/dashboard/billing" className={buttonClasses("primary", "shrink-0")}>
            Add card
          </Link>
        </Card>
      ) : !preference || !location ? (
        <Card className="p-5 text-sm text-coffee">
          Set your usual drink and a default delivery location first, then come back to plan your
          month.{" "}
          <Link href="/onboarding/preferences" className="font-semibold text-coffee underline">
            Set preferences
          </Link>
        </Card>
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
