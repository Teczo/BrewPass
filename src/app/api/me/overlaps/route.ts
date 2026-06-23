import { NextResponse } from "next/server";
import { z } from "zod";

import { corporateAccountsCollection, ordersCollection, usersCollection } from "@/lib/collections";
import { canMemberDecline } from "@/lib/corporate/autonomy";
import { findUserOverlaps, ruleForChoice } from "@/lib/corporate/overlap";
import { localDateSchema } from "@/lib/models/shared";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const actionSchema = z.object({
  date: localDateSchema,
  cancel: z.enum(["personal", "office"]),
  /** Remember-my-choice: persist this as a standing rule (no daily prompt). */
  remember: z.boolean().optional(),
});

const ruleSchema = z.object({
  rule: z.enum(["keep_both", "skip_personal", "skip_office"]),
});

/**
 * Phase J.5 — advisory same-day overlap surface (non-blocking). Lists upcoming
 * days where the member has both a personal and an office coffee, plus their
 * standing rule. The default is keep both; this never forces a choice.
 */
export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const overlaps = await findUserOverlaps(user._id);
  return NextResponse.json({ rule: user.overlapRule ?? "keep_both", overlaps });
}

/**
 * One-tap "cancel one side" on an overlap day. Cancelling the personal coffee is
 * always allowed (it's the member's own); cancelling the office coffee is gated
 * by the company's decline setting (rule #18). With `remember`, the matching
 * standing rule is saved so future overlap days reconcile automatically (rule
 * #17 — no mandatory daily prompt). Idempotent: only skips still-`scheduled`
 * orders before cutoff. Never cancels the side the member didn't choose.
 */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { date, cancel, remember } = parsed.data;
  const now = new Date();
  const orders = await ordersCollection();

  let skipped = 0;
  if (cancel === "personal") {
    const result = await orders.updateOne(
      {
        userId: user._id,
        date,
        source: "personal",
        status: "scheduled",
        cutoffAt: { $gt: now },
      },
      { $set: { status: "skipped", modifiedByUserAt: now, updatedAt: now } },
    );
    skipped = result.modifiedCount;
  } else {
    const officeOrders = await orders
      .find({
        userId: user._id,
        date,
        source: "corporate",
        status: "scheduled",
        cutoffAt: { $gt: now },
      })
      .toArray();
    if (officeOrders.length > 0) {
      const accountIds = [
        ...new Map(
          officeOrders
            .filter((o) => o.corporateAccountId)
            .map((o) => [o.corporateAccountId!.toHexString(), o.corporateAccountId!]),
        ).values(),
      ];
      const accounts = await corporateAccountsCollection();
      const accountDocs = await accounts.find({ _id: { $in: accountIds } }).toArray();
      const declineById = new Map(
        accountDocs.map((a) => [a._id.toHexString(), canMemberDecline(a)]),
      );

      for (const office of officeOrders) {
        const allowed = office.corporateAccountId
          ? declineById.get(office.corporateAccountId.toHexString())
          : false;
        if (!allowed) continue;
        const result = await orders.updateOne(
          { _id: office._id, status: "scheduled", cutoffAt: { $gt: now } },
          { $set: { status: "skipped", modifiedByUserAt: now, updatedAt: now } },
        );
        skipped += result.modifiedCount;
      }

      if (skipped === 0) {
        return NextResponse.json(
          { error: "Your company doesn't allow skipping office coffee." },
          { status: 403 },
        );
      }
    }
  }

  if (remember) {
    const users = await usersCollection();
    await users.updateOne(
      { _id: user._id },
      { $set: { overlapRule: ruleForChoice(cancel), updatedAt: now } },
    );
  }

  return NextResponse.json({ ok: true, skipped });
}

/**
 * Set the standing overlap rule directly without skipping anything today —
 * e.g. "keep both and don't ask again". Setting any rule (including
 * `keep_both`) dismisses the advisory notice; future overlap days reconcile via
 * `reconcileOverlapsForDate` at generation.
 */
export async function PUT(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = ruleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const users = await usersCollection();
  await users.updateOne(
    { _id: user._id },
    { $set: { overlapRule: parsed.data.rule, updatedAt: new Date() } },
  );
  return NextResponse.json({ ok: true });
}
