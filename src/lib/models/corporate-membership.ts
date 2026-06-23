import { z } from "zod";

import { baseDocumentSchema, objectIdSchema } from "@/lib/models/shared";

/**
 * Phase J.0 — corporate membership as a *relationship*, not a role mutation.
 *
 * This is the source of truth for "user X belongs to company Y", replacing the
 * raw `CorporateAccount.memberUserIds` array (migrated in the Phase J.0
 * migration). Crucially, holding a membership NEVER changes the member's
 * personal `User.role`, subscription, or preferences (critical rule #16): a
 * person can be a personal subscriber and an office member at the same time,
 * and the two coexist without either overriding the other.
 *
 * Per-member office state lives here. `officePreferenceId` points at the
 * member's office-scope Preference (added in J.2); it is optional until then.
 * There is no seat and no pre-paid subscription — the company is billed per
 * delivered office coffee on the company card (charge-then-deliver), so this
 * row carries membership state only, never billing entitlement.
 */
export const corporateMembershipStatusSchema = z.enum(["invited", "active", "removed"]);
export type CorporateMembershipStatus = z.infer<typeof corporateMembershipStatusSchema>;

/** How the member came to belong to the company. `email` is the legacy
 * owner-adds-by-email path (J.0); `code`/`invite` are the self-join paths
 * added in J.1. */
export const corporateJoinMethodSchema = z.enum(["code", "invite", "email"]);
export type CorporateJoinMethod = z.infer<typeof corporateJoinMethodSchema>;

export const corporateMembershipSchema = baseDocumentSchema.extend({
  corporateAccountId: objectIdSchema,
  userId: objectIdSchema,
  status: corporateMembershipStatusSchema,
  /** The member's office-scope Preference (Phase J.2). Unset until they (or
   * the owner defaults) configure office coffee. Never the personal one. */
  officePreferenceId: objectIdSchema.optional(),
  joinedVia: corporateJoinMethodSchema,
  invitedAt: z.date().optional(),
  joinedAt: z.date().optional(),
  removedAt: z.date().optional(),
});
export type CorporateMembership = z.infer<typeof corporateMembershipSchema>;
