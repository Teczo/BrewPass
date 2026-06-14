import { NextResponse } from "next/server";
import { z } from "zod";

import { locationsCollection, preferencesCollection } from "@/lib/collections";
import { getOrCreateCurrentUser } from "@/lib/users";
import { PRIORITY_KEYS, recommendVendor } from "@/lib/vendor-recommender";
import { loadVendorCardsForUser } from "@/lib/vendor-selection";

export const runtime = "nodejs";

const priorityField = z.number().int().min(0).max(3);
const inputSchema = z.object({
  priorities: z.object({
    proximity: priorityField,
    price: priorityField,
    speed: priorityField,
    rating: priorityField,
    drink: priorityField,
  }),
});

/**
 * AI vendor recommendation from the priorities questionnaire. Returns the
 * recommendation plus the candidate vendors so the UI can show it and let
 * the user edit before confirming (critical rule #5). Server-only — the
 * Claude call never reaches the client (critical rule #2).
 */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  // Zod guarantees the five keys; assert the recommender's Priorities shape.
  const priorities = parsed.data.priorities as Record<(typeof PRIORITY_KEYS)[number], number>;

  const [preferences, locations] = await Promise.all([
    preferencesCollection(),
    locationsCollection(),
  ]);
  const preference = await preferences.findOne({ userId: user._id });
  const location = preference
    ? await locations.findOne({ _id: preference.defaultLocationId, userId: user._id })
    : null;
  if (!preference || !location) {
    return NextResponse.json(
      { error: "Set your usual drink and a default location first." },
      { status: 422 },
    );
  }

  const vendors = await loadVendorCardsForUser(location.geo, {
    drink: preference.defaultDrink.drink,
    milk: preference.defaultDrink.milk,
  });
  const recommendation = await recommendVendor(vendors, priorities);

  return NextResponse.json({ recommendation, vendors });
}
