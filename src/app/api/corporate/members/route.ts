import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  cancelCorporateMemberSubscription,
  upsertCorporateMemberSubscription,
} from "@/lib/billing";
import { corporateAccountsCollection, usersCollection } from "@/lib/collections";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const addSchema = z.object({ email: z.string().email() });
const removeSchema = z.object({ userId: z.string().regex(/^[0-9a-f]{24}$/i) });

async function getOwnedAccount(userId: ObjectId) {
  const accounts = await corporateAccountsCollection();
  return accounts.findOne({ billingOwnerUserId: userId });
}

/** Add a member (by signup email) to one of the company's seats. */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (account.memberUserIds.length >= account.seatCount) {
    return NextResponse.json(
      { error: "All seats are taken — increase the seat count first." },
      { status: 409 },
    );
  }

  const users = await usersCollection();
  const member = await users.findOne({ email: parsed.data.email });
  if (!member) {
    return NextResponse.json(
      { error: "No account with that email — they need to sign up first." },
      { status: 404 },
    );
  }
  if (account.memberUserIds.some((id) => id.equals(member._id))) {
    return NextResponse.json({ error: "Already a member." }, { status: 409 });
  }

  const now = new Date();
  const accounts = await corporateAccountsCollection();
  const updated = await accounts.findOneAndUpdate(
    // Re-check the seat limit atomically against concurrent adds.
    {
      _id: account._id,
      $expr: { $lt: [{ $size: "$memberUserIds" }, "$seatCount"] },
    },
    { $addToSet: { memberUserIds: member._id }, $set: { updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!updated) {
    return NextResponse.json(
      { error: "All seats are taken — increase the seat count first." },
      { status: 409 },
    );
  }

  if (member.role === "individual" || member.role === "student") {
    await users.updateOne({ _id: member._id }, { $set: { role: "corporate", updatedAt: now } });
  }
  // If the company subscription is live, the member starts immediately.
  await upsertCorporateMemberSubscription(updated, member._id, now);

  return NextResponse.json({ ok: true });
}

/** Remove a member; their seat subscription is canceled immediately. */
export async function DELETE(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const memberId = new ObjectId(parsed.data.userId);
  const now = new Date();
  const accounts = await corporateAccountsCollection();
  await accounts.updateOne(
    { _id: account._id },
    { $pull: { memberUserIds: memberId }, $set: { updatedAt: now } },
  );
  await cancelCorporateMemberSubscription(account._id, memberId, now);

  return NextResponse.json({ ok: true });
}
