import { ObjectId } from "mongodb";

import { corporateMembershipsCollection, preferencesCollection } from "@/lib/collections";
import { newDocumentMeta } from "@/lib/models";
import type { CorporateAccount, CorporateMembership, Preference } from "@/lib/models";
import { officePreferenceFilter, officeScope } from "@/lib/preferences";

/**
 * Phase J.2 — resolve a member's office preference for one membership, lazily
 * seeding it from the company's `officeDefaults` the first time. Returns null
 * when no office preference exists and there are no `officeDefaults` to seed
 * from (the owner hasn't configured office coffee yet).
 *
 * This NEVER touches the member's personal preference (a separate scope), so
 * a member's personal coffee is untouched by anything office-related (critical
 * rule #16). The seeded preference is keyed on the (userId, scope) unique
 * index, and `officePreferenceId` is linked back onto the membership.
 */
export async function getOrSeedOfficePreference(
  account: CorporateAccount,
  membership: CorporateMembership,
  now: Date = new Date(),
): Promise<Preference | null> {
  const preferences = await preferencesCollection();
  const filter = officePreferenceFilter(membership.userId, membership._id);

  const existing = await preferences.findOne(filter);
  if (existing) return existing;

  // Nothing to seed from yet — the owner hasn't set office defaults.
  if (!account.officeDefaults) return null;

  const doc: Preference = {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    userId: membership.userId,
    scope: officeScope(membership._id),
    defaultDrink: account.officeDefaults.drink,
    schedule: account.officeDefaults.schedule,
    defaultLocationId: account.officeDefaults.locationId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await preferences.insertOne(doc);
  } catch (err) {
    // Lost a race against a concurrent seed — return whatever landed.
    if (err && typeof err === "object" && (err as { code?: number }).code === 11000) {
      return preferences.findOne(filter);
    }
    throw err;
  }

  // Link the office preference back onto the membership for quick lookups.
  const memberships = await corporateMembershipsCollection();
  await memberships.updateOne(
    { _id: membership._id },
    { $set: { officePreferenceId: doc._id, updatedAt: now } },
  );

  return doc;
}
