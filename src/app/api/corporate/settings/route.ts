import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { corporateAccountsCollection } from "@/lib/collections";
import { resolveSelectionMode } from "@/lib/corporate/autonomy";
import { drinkSpecSchema } from "@/lib/models";
import { findUncoveredDrinkField, loadDrinkValueSets } from "@/lib/taxonomy";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const settingsSchema = z
  .object({
    selectionMode: z.enum(["bundle", "individual"]).optional(),
    memberSelfSelect: z.boolean().optional(),
    memberCanDecline: z.boolean().optional(),
    bundleDrink: drinkSpecSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No settings provided" });

async function getOwnedAccount(userId: ObjectId) {
  const accounts = await corporateAccountsCollection();
  return accounts.findOne({ billingOwnerUserId: userId });
}

/** Current autonomy settings + bundle drink. */
export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  return NextResponse.json({
    selectionMode: resolveSelectionMode(account),
    memberSelfSelect: account.memberSelfSelect ?? true,
    memberCanDecline: account.memberCanDecline ?? true,
    bundleDrink: account.bundleDrink ?? null,
  });
}

/**
 * Phase J.3 — the owner updates autonomy controls. These are enforced
 * server-side on member mutations (rule #18); this endpoint just persists the
 * owner's choices. Switching to `bundle` requires a bundle drink (provided
 * here or already set), and any bundle drink must reference the taxonomy.
 */
export async function PUT(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  if (input.bundleDrink) {
    const valueSets = await loadDrinkValueSets();
    const uncovered = findUncoveredDrinkField(valueSets, input.bundleDrink);
    if (uncovered) {
      return NextResponse.json(
        { error: `"${uncovered.value}" isn't an available ${uncovered.field} option.` },
        { status: 422 },
      );
    }
  }

  // Bundle mode needs a coffee for everyone — incoming or already saved.
  const resultingMode = input.selectionMode ?? resolveSelectionMode(account);
  const resultingBundle = input.bundleDrink ?? account.bundleDrink;
  if (resultingMode === "bundle" && !resultingBundle) {
    return NextResponse.json(
      { error: "Pick the bundle coffee before switching to bundle mode." },
      { status: 422 },
    );
  }

  const now = new Date();
  const set: Record<string, unknown> = { updatedAt: now };
  if (input.selectionMode !== undefined) set.selectionMode = input.selectionMode;
  if (input.memberSelfSelect !== undefined) set.memberSelfSelect = input.memberSelfSelect;
  if (input.memberCanDecline !== undefined) set.memberCanDecline = input.memberCanDecline;
  if (input.bundleDrink !== undefined) set.bundleDrink = input.bundleDrink;

  const accounts = await corporateAccountsCollection();
  await accounts.updateOne({ _id: account._id }, { $set: set });

  return NextResponse.json({ ok: true });
}
