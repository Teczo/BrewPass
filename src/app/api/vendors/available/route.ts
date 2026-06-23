import { NextResponse } from "next/server";

import { locationsCollection, preferencesCollection } from "@/lib/collections";
import { personalPreferenceFilter } from "@/lib/preferences";
import { getOrCreateCurrentUser } from "@/lib/users";
import { loadVendorCardsForUser } from "@/lib/vendor-selection";

export const runtime = "nodejs";

/**
 * Vendors a subscriber can pick as their preferred vendor: active vendors
 * in delivery range of their default location, annotated for their default
 * drink. Read-only — confirming a pick is a separate PUT (critical rule #5).
 */
export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [preferences, locations] = await Promise.all([
    preferencesCollection(),
    locationsCollection(),
  ]);
  const preference = await preferences.findOne(personalPreferenceFilter(user._id));
  if (!preference) {
    return NextResponse.json({ vendors: [], preferredVendorId: null, method: null });
  }

  const location = await locations.findOne({
    _id: preference.defaultLocationId,
    userId: user._id,
  });
  if (!location) {
    return NextResponse.json({ vendors: [], preferredVendorId: null, method: null });
  }

  const vendors = await loadVendorCardsForUser(location.geo, {
    drink: preference.defaultDrink.drink,
    milk: preference.defaultDrink.milk,
  });

  return NextResponse.json({
    vendors,
    preferredVendorId: preference.preferredVendorId?.toHexString() ?? null,
    method: preference.vendorSelectionMethod ?? null,
  });
}
