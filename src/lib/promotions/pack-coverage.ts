import { packPurchasesCollection } from "@/lib/collections";

/**
 * Phase K.1 — when a company has bought a Vendor Pack for a day, that pack flow
 * (not normal per-member office generation) defines who gets office coffee:
 *  - assigned members  → a vendor-pinned pack order, materialized at cutoff;
 *  - top-up members    → a normal routed office order (generated as usual);
 *  - everyone else     → no office coffee that day (the admin switched the
 *    office off per-member selection by buying the pack).
 */
export interface PackCoverage {
  assigned: Set<string>;
  topup: Set<string>;
}

export type MemberGenerationDecision = "generate" | "skip_pack_assigned" | "skip_pack_uncovered";

/**
 * Pure decision: what should normal office generation do for one membership,
 * given its company's pack coverage for the day (or undefined when the company
 * has no pack). Assigned members are skipped here (their pack order is created
 * at cutoff); top-ups generate normally; other members of a packed company are
 * skipped (no office coffee).
 */
export function memberGenerationDecision(
  coverage: PackCoverage | undefined,
  membershipHex: string,
): MemberGenerationDecision {
  if (!coverage) return "generate";
  if (coverage.assigned.has(membershipHex)) return "skip_pack_assigned";
  if (coverage.topup.has(membershipHex)) return "generate";
  return "skip_pack_uncovered";
}

/** Per-company pack coverage for `localDate` (pending purchases only). */
export async function loadPackCoverageByCompany(
  localDate: string,
): Promise<Map<string, PackCoverage>> {
  const packs = await packPurchasesCollection();
  const docs = await packs.find({ date: localDate, status: "pending" }).toArray();
  const map = new Map<string, PackCoverage>();
  for (const pack of docs) {
    map.set(pack.corporateAccountId.toHexString(), {
      assigned: new Set(pack.assignments.map((a) => a.corporateMembershipId.toHexString())),
      topup: new Set(pack.topUpMembershipIds.map((id) => id.toHexString())),
    });
  }
  return map;
}
