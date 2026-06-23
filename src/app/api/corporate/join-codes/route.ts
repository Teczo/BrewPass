import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { corporateAccountsCollection, corporateJoinCodesCollection } from "@/lib/collections";
import { generateJoinCode, normalizeJoinCode } from "@/lib/corporate/join-codes";
import { newDocumentMeta } from "@/lib/models";
import type { CorporateJoinCode } from "@/lib/models";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const createSchema = z.object({
  type: z.enum(["reusable", "single_use"]),
  /** Optional join limit; applies to reusable codes only. */
  redemptionCap: z.number().int().positive().max(100000).optional(),
});
const revokeSchema = z.object({ code: z.string().min(1) });

async function getOwnedAccount(userId: ObjectId) {
  const accounts = await corporateAccountsCollection();
  return accounts.findOne({ billingOwnerUserId: userId });
}

function toJson(doc: CorporateJoinCode) {
  return {
    code: doc.code,
    type: doc.type,
    redemptionCap: doc.redemptionCap ?? null,
    redeemedCount: doc.redeemedCount,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    rotatedAt: doc.rotatedAt?.toISOString() ?? null,
  };
}

/** List the company's join codes (active first, newest first). */
export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const codes = await corporateJoinCodesCollection();
  const docs = await codes
    .find({ corporateAccountId: account._id })
    .sort({ active: -1, createdAt: -1 })
    .toArray();
  return NextResponse.json({ codes: docs.map(toJson) });
}

/**
 * Generate a join code. For `reusable`, this rotates: any previously-active
 * reusable code for the company is deactivated so the company has exactly one
 * live standing code. `single_use` codes are minted alongside without
 * disturbing existing ones.
 */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const codes = await corporateJoinCodesCollection();
  const now = new Date();

  if (parsed.data.type === "reusable") {
    // Rotate: retire prior live standing codes so only the new one works.
    await codes.updateMany(
      { corporateAccountId: account._id, type: "reusable", active: true },
      { $set: { active: false, rotatedAt: now, updatedAt: now } },
    );
  }

  // Generate a globally-unique code, retrying on the rare collision against the
  // unique `code` index.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const doc: CorporateJoinCode = {
      _id: new ObjectId(),
      ...newDocumentMeta(),
      code: generateJoinCode(),
      corporateAccountId: account._id,
      type: parsed.data.type,
      // redemptionCap is meaningless for single_use (implicitly 1).
      ...(parsed.data.type === "reusable" && parsed.data.redemptionCap !== undefined
        ? { redemptionCap: parsed.data.redemptionCap }
        : {}),
      redeemedCount: 0,
      redeemedBy: [],
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await codes.insertOne(doc);
      return NextResponse.json(toJson(doc), { status: 201 });
    } catch (err) {
      if (err && typeof err === "object" && (err as { code?: number }).code === 11000) continue;
      throw err;
    }
  }
  return NextResponse.json({ error: "Could not generate a unique code, try again." }, { status: 503 });
}

/** Revoke (deactivate) a join code. */
export async function DELETE(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const codes = await corporateJoinCodesCollection();
  const now = new Date();
  const result = await codes.updateOne(
    { corporateAccountId: account._id, code: normalizeJoinCode(parsed.data.code), active: true },
    { $set: { active: false, updatedAt: now } },
  );
  if (result.matchedCount === 0) {
    return NextResponse.json({ error: "No active code with that value." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
