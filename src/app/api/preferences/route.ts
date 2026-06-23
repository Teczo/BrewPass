import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { locationsCollection, preferencesCollection, usersCollection } from "@/lib/collections";
import { newDocumentMeta } from "@/lib/models";
import { personalPreferenceFilter, PERSONAL_SCOPE } from "@/lib/preferences";
import { preferenceToJson } from "@/lib/serializers";
import { findUncoveredDrinkField, loadDrinkValueSets } from "@/lib/taxonomy";
import { getOnboardingStatus, getOrCreateCurrentUser } from "@/lib/users";
import { preferenceInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const preferences = await preferencesCollection();
  const doc = await preferences.findOne(personalPreferenceFilter(user._id));
  return NextResponse.json({ preference: doc ? preferenceToJson(doc) : null });
}

export async function PUT(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = preferenceInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // The drink must reference the platform taxonomy (critical rule #3).
  // Fails open per-category when the taxonomy isn't seeded yet.
  const valueSets = await loadDrinkValueSets();
  const uncovered = findUncoveredDrinkField(valueSets, parsed.data.defaultDrink);
  if (uncovered) {
    return NextResponse.json(
      { error: `"${uncovered.value}" isn't an available ${uncovered.field} option.` },
      { status: 422 },
    );
  }

  // The default location must exist and belong to this user.
  const defaultLocationId = new ObjectId(parsed.data.defaultLocationId);
  const locations = await locationsCollection();
  const location = await locations.findOne({ _id: defaultLocationId, userId: user._id });
  if (!location) {
    return NextResponse.json({ error: "Default location not found" }, { status: 422 });
  }

  const now = new Date();
  const preferences = await preferencesCollection();
  // Phase J.2: only ever touch the PERSONAL preference here. Find-then-write
  // (rather than an upsert keyed on a single scope) so a legacy row written
  // before the scope backfill is updated in place — and stamped with the
  // personal scope — instead of spawning a duplicate.
  const existing = await preferences.findOne(personalPreferenceFilter(user._id));
  let updated: typeof existing;
  if (existing) {
    updated = await preferences.findOneAndUpdate(
      { _id: existing._id },
      {
        $set: {
          scope: PERSONAL_SCOPE,
          defaultDrink: parsed.data.defaultDrink,
          schedule: parsed.data.schedule,
          defaultLocationId,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
  } else {
    const doc = {
      _id: new ObjectId(),
      ...newDocumentMeta(),
      userId: user._id,
      scope: PERSONAL_SCOPE,
      defaultDrink: parsed.data.defaultDrink,
      schedule: parsed.data.schedule,
      defaultLocationId,
      createdAt: now,
      updatedAt: now,
    };
    await preferences.insertOne(doc);
    updated = doc;
  }
  if (!updated) {
    return NextResponse.json({ error: "Failed to save preference" }, { status: 500 });
  }

  // Preferences are the last onboarding step — mark completion once
  // profile and location are also in place.
  if (!user.onboardingCompletedAt) {
    const status = await getOnboardingStatus({ ...user, onboardingCompletedAt: undefined });
    if (status.profileComplete && status.hasLocation) {
      const users = await usersCollection();
      await users.updateOne(
        { _id: user._id, onboardingCompletedAt: { $exists: false } },
        { $set: { onboardingCompletedAt: now, updatedAt: now } },
      );
    }
  }

  return NextResponse.json({ preference: preferenceToJson(updated) });
}
