import { redirect } from "next/navigation";

import { LocationsManager } from "@/components/locations-manager";
import { StepIndicator } from "@/components/step-indicator";
import { locationsCollection } from "@/lib/collections";
import { locationToJson } from "@/lib/serializers";
import { getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function OnboardingLocationsPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/onboarding/locations");

  const locations = await locationsCollection();
  const docs = await locations.find({ userId: user._id }).sort({ createdAt: 1 }).toArray();

  return (
    <section className="flex flex-col gap-6">
      <StepIndicator current={2} />
      <LocationsManager initial={docs.map(locationToJson)} nextHref="/onboarding/preferences" />
    </section>
  );
}
