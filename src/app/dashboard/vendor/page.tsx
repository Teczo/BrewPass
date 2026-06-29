import Link from "next/link";
import { redirect } from "next/navigation";

import { VendorSelector } from "@/components/vendor-selector";
import { locationsCollection, preferencesCollection, vendorsCollection } from "@/lib/collections";
import { personalPreferenceFilter } from "@/lib/preferences";
import { getOrCreateCurrentUser } from "@/lib/users";
import { loadVendorCardsForUser } from "@/lib/vendor-selection";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-6">
      <h1 className="font-display text-[26px] leading-tight text-espresso">Choose your vendor</h1>
      <div className="flex flex-col gap-3 text-coffee">{children}</div>
    </main>
  );
}

export default async function VendorSelectionPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/dashboard/vendor");

  const [preferences, locations, vendors] = await Promise.all([
    preferencesCollection(),
    locationsCollection(),
    vendorsCollection(),
  ]);
  const preference = await preferences.findOne(personalPreferenceFilter(user._id));
  if (!preference) {
    return (
      <Notice>
        <p>Set your usual drink and schedule first.</p>
        <Link href="/onboarding/preferences" className="font-semibold text-coffee hover:underline">
          Set up preferences
        </Link>
      </Notice>
    );
  }

  const location = await locations.findOne({
    _id: preference.defaultLocationId,
    userId: user._id,
  });
  if (!location) {
    return (
      <Notice>
        <p>Add a default delivery location first.</p>
        <Link href="/onboarding/locations" className="font-semibold text-coffee hover:underline">
          Manage locations
        </Link>
      </Notice>
    );
  }

  const cards = await loadVendorCardsForUser(location.geo, {
    drink: preference.defaultDrink.drink,
    milk: preference.defaultDrink.milk,
  });

  // Resolve the confirmed vendor's name for the banner (it may be out of
  // area now and absent from the cards).
  let preferredVendorName: string | null = null;
  if (preference.preferredVendorId) {
    const preferred = await vendors.findOne(
      { _id: preference.preferredVendorId },
      { projection: { businessName: 1 } },
    );
    preferredVendorName = preferred?.businessName ?? null;
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[26px] leading-tight text-espresso">
          Choose your vendor
        </h1>
        <p className="text-sm text-coffee">
          Two doors to the same calm result. Takes effect only when you confirm.
        </p>
      </header>
      <VendorSelector
        vendors={cards}
        drinkName={preference.defaultDrink.drink}
        preferredVendorId={preference.preferredVendorId?.toHexString() ?? null}
        preferredVendorName={preferredVendorName}
        method={preference.vendorSelectionMethod ?? null}
      />
    </main>
  );
}
