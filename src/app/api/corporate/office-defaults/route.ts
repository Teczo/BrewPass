import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import {
  corporateAccountsCollection,
  locationsCollection,
} from "@/lib/collections";
import { findUncoveredDrinkField, loadDrinkValueSets } from "@/lib/taxonomy";
import { getOrCreateCurrentUser } from "@/lib/users";
import { officeDefaultsInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

async function getOwnedAccount(userId: ObjectId) {
  const accounts = await corporateAccountsCollection();
  return accounts.findOne({ billingOwnerUserId: userId });
}

/** Current office defaults (the seed for members' office preferences). */
export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  return NextResponse.json({ officeDefaults: account.officeDefaults ?? null });
}

/**
 * Phase J.2 — the owner sets the company's office defaults: the drink,
 * schedule, and office delivery location each member's office preference is
 * seeded from. The drink must reference the platform taxonomy (rule #5) and
 * the location must belong to the owner.
 */
export async function PUT(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const parsed = officeDefaultsInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  // The drink must map onto the platform taxonomy (fails open per-category
  // when the taxonomy isn't seeded yet), mirroring the personal preference PUT.
  const valueSets = await loadDrinkValueSets();
  const uncovered = findUncoveredDrinkField(valueSets, parsed.data.drink);
  if (uncovered) {
    return NextResponse.json(
      { error: `"${uncovered.value}" isn't an available ${uncovered.field} option.` },
      { status: 422 },
    );
  }

  // The office location must be one the owner owns.
  const locationId = new ObjectId(parsed.data.locationId);
  const locations = await locationsCollection();
  const location = await locations.findOne({ _id: locationId, userId: user._id });
  if (!location) {
    return NextResponse.json({ error: "Office location not found" }, { status: 422 });
  }

  const now = new Date();
  const accounts = await corporateAccountsCollection();
  await accounts.updateOne(
    { _id: account._id },
    {
      $set: {
        officeDefaults: {
          drink: parsed.data.drink,
          schedule: parsed.data.schedule,
          locationId,
        },
        updatedAt: now,
      },
    },
  );

  return NextResponse.json({ ok: true });
}
