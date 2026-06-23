import type { Filter, ObjectId } from "mongodb";

import { PERSONAL_PREFERENCE_SCOPE, type Preference } from "@/lib/models";

/**
 * Phase J.2 — preference scoping. Preferences are keyed per (`userId`,
 * `scope`); these helpers are the single source of truth for building the
 * scope value and the read/write filters so personal and office coffee never
 * leak into each other (critical rule #16).
 */

export const PERSONAL_SCOPE = PERSONAL_PREFERENCE_SCOPE;

/** Office-scope value for a membership: its hex id (per CLAUDE.md, scope is
 * `"personal"` or a corporateMembershipId). */
export function officeScope(membershipId: ObjectId): string {
  return membershipId.toHexString();
}

/**
 * Filter for a user's PERSONAL preference. Tolerates legacy rows written
 * before the J.2 scope backfill (a missing `scope` is treated as personal),
 * so personal reads keep working in the window before the migration runs.
 */
export function personalPreferenceFilter(userId: ObjectId): Filter<Preference> {
  return { userId, scope: { $in: [PERSONAL_SCOPE, null] } } as Filter<Preference>;
}

/** Filter for a member's office preference for one membership. */
export function officePreferenceFilter(
  userId: ObjectId,
  membershipId: ObjectId,
): Filter<Preference> {
  return { userId, scope: officeScope(membershipId) };
}
