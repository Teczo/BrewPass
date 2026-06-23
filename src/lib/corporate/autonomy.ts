import type { CorporateAccount } from "@/lib/models";

/**
 * Phase J.3 — owner autonomy controls, server-authoritative (critical rule
 * #18). These pure resolvers/policies are the SINGLE enforcement point for
 * member office-coffee mutations: the office-preference editor calls them
 * today, and the office-order mutations added in J.5 must call the same
 * functions so the rules can never be bypassed by hitting the API directly.
 *
 * Unset fields read as the confirmed defaults, so accounts created before J.3
 * (and the one set on creation) behave identically without a data backfill.
 */
export const CORPORATE_AUTONOMY_DEFAULTS = {
  selectionMode: "individual",
  memberSelfSelect: true,
  memberCanDecline: true,
} as const;

/** Minimal shape the policies need — the full account satisfies it. */
export type AutonomySettings = Pick<
  CorporateAccount,
  "selectionMode" | "memberSelfSelect" | "memberCanDecline"
>;

export function resolveSelectionMode(account: AutonomySettings): "bundle" | "individual" {
  return account.selectionMode ?? CORPORATE_AUTONOMY_DEFAULTS.selectionMode;
}

export function resolveMemberSelfSelect(account: AutonomySettings): boolean {
  return account.memberSelfSelect ?? CORPORATE_AUTONOMY_DEFAULTS.memberSelfSelect;
}

export function resolveMemberCanDecline(account: AutonomySettings): boolean {
  return account.memberCanDecline ?? CORPORATE_AUTONOMY_DEFAULTS.memberCanDecline;
}

/**
 * May a member choose/edit their OWN office coffee? Only when self-select is
 * on AND the company is in `individual` mode — in `bundle` mode the owner
 * picks one coffee for everyone, so members never edit the drink.
 */
export function canMemberSelectOffice(account: AutonomySettings): boolean {
  return resolveMemberSelfSelect(account) && resolveSelectionMode(account) === "individual";
}

/** May a member skip a day's office coffee ("don't want today")? */
export function canMemberDecline(account: AutonomySettings): boolean {
  return resolveMemberCanDecline(account);
}
