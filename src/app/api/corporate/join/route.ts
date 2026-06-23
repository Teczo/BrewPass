import { NextResponse } from "next/server";
import { z } from "zod";

import {
  corporateAccountsCollection,
  corporateJoinCodesCollection,
  corporateMembershipsCollection,
} from "@/lib/collections";
import {
  effectiveCap,
  evaluateRedemption,
  isSpentAfterRedemption,
  normalizeJoinCode,
  redemptionRefusalMessage,
} from "@/lib/corporate/join-codes";
import { newDocumentMeta } from "@/lib/models";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const redeemSchema = z.object({ code: z.string().min(1).max(40) });

/**
 * Phase J.1 — a staff member redeems a join code to self-join a company. This
 * creates an `active` CorporateMembership and NOTHING else: the member's
 * personal account is untouched (critical rule #16) and no seat subscription is
 * created — office coffee is billed per delivery on the company card (rule #17).
 */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = redeemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const normalized = normalizeJoinCode(parsed.data.code);
  const codes = await corporateJoinCodesCollection();
  const code = await codes.findOne({ code: normalized });
  if (!code) {
    return NextResponse.json({ error: "That join code isn't valid." }, { status: 404 });
  }

  const accounts = await corporateAccountsCollection();
  const account = await accounts.findOne({ _id: code.corporateAccountId });
  if (!account) {
    return NextResponse.json({ error: "That join code isn't valid." }, { status: 404 });
  }

  const memberships = await corporateMembershipsCollection();
  const existing = await memberships.findOne({
    corporateAccountId: code.corporateAccountId,
    userId: user._id,
    status: "active",
  });

  const decision = evaluateRedemption(
    {
      active: code.active,
      type: code.type,
      redemptionCap: code.redemptionCap,
      redeemedCount: code.redeemedCount,
      redeemedByHex: code.redeemedBy.map((id) => id.toHexString()),
    },
    user._id.toHexString(),
    Boolean(existing),
  );
  if (!decision.ok) {
    const status = decision.reason === "already_member" ? 409 : 400;
    return NextResponse.json({ error: redemptionRefusalMessage(decision.reason) }, { status });
  }

  // Atomically claim a redemption. The filter re-checks every condition so a
  // race (two members redeeming a single_use / last-capped slot at once) can
  // only let one through — the loser gets a conflict, never an over-redemption.
  const cap = effectiveCap(code.type, code.redemptionCap);
  const claimed = await codes.findOneAndUpdate(
    {
      _id: code._id,
      active: true,
      redeemedBy: { $ne: user._id },
      ...(cap !== undefined ? { $expr: { $lt: ["$redeemedCount", cap] } } : {}),
    },
    { $inc: { redeemedCount: 1 }, $addToSet: { redeemedBy: user._id }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) {
    // Lost the race or state changed between read and claim.
    return NextResponse.json(
      { error: "This join code is no longer available." },
      { status: 409 },
    );
  }

  const now = new Date();
  // Spend the code if this redemption hit its cap (single_use always; a capped
  // reusable code when it reaches the limit).
  if (isSpentAfterRedemption(code.type, code.redemptionCap, claimed.redeemedCount)) {
    await codes.updateOne({ _id: code._id }, { $set: { active: false, updatedAt: now } });
  }

  // Establish membership (no seat subscription). Keyed (account, user) so a
  // previously-`removed` member who re-joins flips back to `active`.
  await memberships.updateOne(
    { corporateAccountId: code.corporateAccountId, userId: user._id },
    {
      $set: {
        status: "active",
        joinedVia: code.type === "single_use" ? "invite" : "code",
        joinedAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        ...newDocumentMeta(),
        corporateAccountId: code.corporateAccountId,
        userId: user._id,
        createdAt: now,
      },
      $unset: { removedAt: "" },
    },
    { upsert: true },
  );

  return NextResponse.json({ ok: true, company: account.company });
}
