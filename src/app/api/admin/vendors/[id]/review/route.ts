import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { usersCollection, vendorsCollection } from "@/lib/collections";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const reviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), note: z.string().trim().min(1).max(500) }),
]);

/**
 * Review a pending vendor application. The pending → active/rejected
 * transition is claimed atomically, so concurrent reviews can't both win.
 * Approval also flags the owner's account with the vendor role (their
 * portal access itself comes from portalUserSubs, set at application).
 */
export async function POST(request: Request, context: RouteContext) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const now = new Date();
  const vendors = await vendorsCollection();
  const vendor = await vendors.findOneAndUpdate(
    { _id: new ObjectId(id), status: "pending" },
    input.action === "approve"
      ? { $set: { status: "active" as const, reviewedAt: now, updatedAt: now } }
      : {
          $set: {
            status: "rejected" as const,
            reviewedAt: now,
            reviewNote: input.note,
            updatedAt: now,
          },
        },
    { returnDocument: "after" },
  );
  if (!vendor) {
    return NextResponse.json(
      { error: "Application not found or already reviewed." },
      { status: 409 },
    );
  }

  if (input.action === "approve" && vendor.ownerUserId) {
    const users = await usersCollection();
    // Admins keep their admin role.
    await users.updateOne(
      { _id: vendor.ownerUserId, role: { $ne: "admin" } },
      { $set: { role: "vendor", updatedAt: now } },
    );
  }

  return NextResponse.json({ ok: true, status: vendor.status });
}
