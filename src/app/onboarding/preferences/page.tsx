import { redirect } from "next/navigation";

import { PreferencesForm } from "@/components/preferences-form";
import { StepIndicator } from "@/components/step-indicator";
import { locationsCollection, preferencesCollection } from "@/lib/collections";
import { locationToJson, preferenceToJson } from "@/lib/serializers";
import { drinkOptionsFrom, loadActiveTaxonomy } from "@/lib/taxonomy";
import { DEFAULT_DRINK_OPTIONS } from "@/lib/taxonomy-options";
import { getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function OnboardingPreferencesPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/onboarding/preferences");

  const [locations, preferences] = await Promise.all([
    locationsCollection(),
    preferencesCollection(),
  ]);
  const [locationDocs, preference, taxonomy] = await Promise.all([
    locations.find({ userId: user._id }).sort({ createdAt: 1 }).toArray(),
    preferences.findOne({ userId: user._id }),
    loadActiveTaxonomy(),
  ]);

  // Need at least one location to pick a default — back to step 2.
  if (locationDocs.length === 0) redirect("/onboarding/locations");

  return (
    <section className="flex flex-col gap-6">
      <StepIndicator current={3} />
      <PreferencesForm
        locations={locationDocs.map(locationToJson)}
        initial={preference ? preferenceToJson(preference) : null}
        nextHref="/dashboard"
        options={drinkOptionsFrom(taxonomy) ?? DEFAULT_DRINK_OPTIONS}
      />
    </section>
  );
}
