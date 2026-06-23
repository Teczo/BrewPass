import { ObjectId, type UpdateFilter } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { corporateAccountsCollection, ordersCollection } from "@/lib/collections";
import { canOwnerToggleMemberWant } from "@/lib/corporate/autonomy";
import type { Order } from "@/lib/models";
import { localDateSchema } from "@/lib/models/shared";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const bodySchema = z.object({
  membershipId: z.string().regex(/^[0-9a-f]{24}$/i),
  date: localDateSchema,
  action: z.enum(["want", "skip"]),
});

/**
 * Phase J.4 — the owner toggles want/skip on a member's office coffee for a
 * given day. Server-authoritative (rule #18): the company must allow declining
 * (`canOwnerToggleMemberWant`), the order must belong to the owner's company,
 * and the change is gated on the order still being before its cutoff in the DB
 * itself — so a request racing the cutoff job can never edit a locked order
 * (rule #2). Office coffee only; the member's personal coffee is never touched
 * (rule #17).
 */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accounts = await corporateAccountsCollection();
  const account = await accounts.findOne({ billingOwnerUserId: user._id });
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (!canOwnerToggleMemberWant(account)) {
    return NextResponse.json(
      { error: "Declining is turned off for your company — turn it on in settings to skip days." },
      { status: 403 },
    );
  }

  const { membershipId, date, action } = parsed.data;
  const now = new Date();
  const fromStatus: Order["status"] = action === "skip" ? "scheduled" : "skipped";
  const toStatus: Order["status"] = action === "skip" ? "skipped" : "scheduled";
  const update: UpdateFilter<Order> = {
    $set: { status: toStatus, modifiedByUserAt: now, updatedAt: now },
  };

  const orders = await ordersCollection();
  const filter = {
    source: "corporate" as const,
    corporateAccountId: account._id,
    corporateMembershipId: new ObjectId(membershipId),
    date,
  };

  const updated = await orders.findOneAndUpdate(
    { ...filter, status: fromStatus, cutoffAt: { $gt: now } },
    update,
    { returnDocument: "after" },
  );

  if (!updated) {
    const existing = await orders.findOne(filter);
    if (!existing) {
      return NextResponse.json(
        { error: "No office coffee for that member on that day." },
        { status: 404 },
      );
    }
    if (existing.cutoffAt.getTime() <= now.getTime()) {
      return NextResponse.json(
        { error: "This order is locked — the cutoff has passed." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: `This order is already ${existing.status} and can't be ${action === "skip" ? "skipped" : "restored"}.`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, status: updated.status });
}
