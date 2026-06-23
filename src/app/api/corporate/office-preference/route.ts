import { NextResponse } from "next/server";

import {
  corporateAccountsCollection,
  corporateMembershipsCollection,
} from "@/lib/collections";
import { getOrSeedOfficePreference } from "@/lib/corporate/office-preference";
import { preferenceToJson } from "@/lib/serializers";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

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

  const offices = await Promise.all(
    memberDocs.map(async (membership) => {
      const account = accountById.get(membership.corporateAccountId.toHexString());
      const preference = account ? await getOrSeedOfficePreference(account, membership) : null;
      return {
        membershipId: membership._id.toHexString(),
        company: account?.company ?? null,
        preference: preference ? preferenceToJson(preference) : null,
      };
    }),
  );

  return NextResponse.json({ offices });
}
