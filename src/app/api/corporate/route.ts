import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { corporateAccountsCollection, usersCollection } from "@/lib/collections";
import { CORPORATE_AUTONOMY_DEFAULTS } from "@/lib/corporate/autonomy";
import { newDocumentMeta } from "@/lib/models";
import type { CorporateAccount } from "@/lib/models";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const createSchema = z.object({ company: z.string().trim().min(2).max(160) });

/** Create a corporate account with the current user as billing owner. */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const accounts = await corporateAccountsCollection();
  const existing = await accounts.findOne({ billingOwnerUserId: user._id });
  if (existing) {
    return NextResponse.json({ error: "You already manage a corporate account." }, { status: 409 });
  }

  const now = new Date();
  const account: CorporateAccount = {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    company: parsed.data.company,
    billingOwnerUserId: user._id,
    memberUserIds: [],
    seatCount: 1,
    // Phase J.3 — start with the confirmed autonomy defaults (individual /
    // self-select on / decline on); the owner can change them in settings.
    selectionMode: CORPORATE_AUTONOMY_DEFAULTS.selectionMode,
    memberSelfSelect: CORPORATE_AUTONOMY_DEFAULTS.memberSelfSelect,
    memberCanDecline: CORPORATE_AUTONOMY_DEFAULTS.memberCanDecline,
    createdAt: now,
    updatedAt: now,
  };
  await accounts.insertOne(account);

  // Billing owners are corporate users (privileged roles stay untouched).
  if (user.role === "individual" || user.role === "student") {
    const users = await usersCollection();
    await users.updateOne({ _id: user._id }, { $set: { role: "corporate", updatedAt: now } });
  }

  return NextResponse.json({ id: account._id.toHexString() }, { status: 201 });
}
