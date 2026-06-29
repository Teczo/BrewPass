import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  corporateAccountsCollection,
  corporateMembershipsCollection,
  locationsCollection,
  preferencesCollection,
} from "@/lib/collections";
import { canMemberSelectOffice } from "@/lib/corporate/autonomy";
import { getOrSeedOfficePreference } from "@/lib/corporate/office-preference";
import { deliveryScheduleSchema, drinkSpecSchema } from "@/lib/models";
import { officePreferenceFilter } from "@/lib/preferences";
import { preferenceToJson } from "@/lib/serializers";
import { findUncoveredDrinkField, loadDrinkValueSets } from "@/lib/taxonomy";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const editSchema = z
  .object({
    membershipId: z.string().regex(/^[0-9a-f]{24}$/i),
    drink: drinkSpecSchema.optional(),
    schedule: deliveryScheduleSchema.optional(),
  })
  .refine((v) => v.drink !== undefined || v.schedule !== undefined, {
    message: "Provide a drink and/or schedule to update.",
  });

/**
 * Phase J.2 — a member's office preference(s), one per active membership,
 * each lazily seeded from the company's officeDefaults. `preference` is null
 * when the owner hasn't configured office coffee yet. The member's personal
 * preference is a separate scope and is never returned here (rule #16).
 */
export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberships = await corporateMembershipsCollection();
  const memberDocs = await memberships.find({ userId: user._id, status: "active" }).toArray();
  if (memberDocs.length === 0) return NextResponse.json({ offices: [] });

  const accounts = await corporateAccountsCollection();
  const accountDocs = await accounts
    .find({ _id: { $in: memberDocs.map((m) => m.corporateAccountId) } })
    .toArray();
  const accountById = new Map(accountDocs.map((a) => [a._id.toHexString(), a]));

  const locations = await locationsCollection();
  const offices = await Promise.all(
    memberDocs.map(async (membership) => {
      const account = accountById.get(membership.corporateAccountId.toHexString());
      const preference = account ? await getOrSeedOfficePreference(account, membership) : null;
      // Resolve the owner-controlled office location label for read-only display.
      const locationDoc = preference
        ? await locations.findOne({ _id: preference.defaultLocationId })
        : null;
      return {
        membershipId: membership._id.toHexString(),
        company: account?.company ?? null,
        // Surfaces existing server state for the UI; the PUT remains the
        // authoritative gate (rule #18), so this never relaxes enforcement.
        canSelfSelect: account ? canMemberSelectOffice(account) : false,
        locationLabel: locationDoc?.label ?? null,
        preference: preference ? preferenceToJson(preference) : null,
      };
    }),
  );

  return NextResponse.json({ offices });
}

/**
 * Phase J.3 — a member edits their own office coffee. Server-authoritative
 * (rule #18): allowed only when the company is in `individual` mode AND
 * `memberSelfSelect` is on (`canMemberSelectOffice`). Editing the drink is
 * checked against the taxonomy; the office location stays owner-controlled
 * (office defaults), so members adjust only drink and schedule.
 */
export async function PUT(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = editSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const memberships = await corporateMembershipsCollection();
  const membership = await memberships.findOne({
    _id: new ObjectId(parsed.data.membershipId),
    userId: user._id,
    status: "active",
  });
  if (!membership) {
    return NextResponse.json({ error: "Membership not found" }, { status: 404 });
  }

  const accounts = await corporateAccountsCollection();
  const account = await accounts.findOne({ _id: membership.corporateAccountId });
  if (!account) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // Server-side autonomy enforcement — never rely on the UI hiding this.
  if (!canMemberSelectOffice(account)) {
    return NextResponse.json(
      { error: "Your company doesn't allow members to set their own office coffee." },
      { status: 403 },
    );
  }

  // The office preference must exist (seeded from office defaults). If the
  // owner hasn't configured office coffee, there's nothing to edit yet.
  const seeded = await getOrSeedOfficePreference(account, membership);
  if (!seeded) {
    return NextResponse.json(
      { error: "Your company hasn't set up office coffee yet." },
      { status: 409 },
    );
  }

  if (parsed.data.drink) {
    const valueSets = await loadDrinkValueSets();
    const uncovered = findUncoveredDrinkField(valueSets, parsed.data.drink);
    if (uncovered) {
      return NextResponse.json(
        { error: `"${uncovered.value}" isn't an available ${uncovered.field} option.` },
        { status: 422 },
      );
    }
  }

  const now = new Date();
  const set: Record<string, unknown> = { updatedAt: now };
  if (parsed.data.drink) set.defaultDrink = parsed.data.drink;
  if (parsed.data.schedule) set.schedule = parsed.data.schedule;

  const preferences = await preferencesCollection();
  const updated = await preferences.findOneAndUpdate(
    officePreferenceFilter(membership.userId, membership._id),
    { $set: set },
    { returnDocument: "after" },
  );
  if (!updated) {
    return NextResponse.json({ error: "Failed to save office preference" }, { status: 500 });
  }

  return NextResponse.json({ preference: preferenceToJson(updated) });
}
