import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { usersCollection, vendorsCollection } from "@/lib/collections";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const updateCafeSchema = z.object({
  active: z.boolean().optional(),
  capacityPerHour: z.number().int().min(1).max(1000).optional(),
  /** Link a staff member by the email they signed up with. */
  addStaffEmail: z.string().email().optional(),
  /** Unlink a staff member by Auth0 sub. */
  removeStaffSub: z.string().optional(),
});

export async function PATCH(request: Request, context: RouteContext) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const vendorId = new ObjectId(id);

  const parsed = updateCafeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const vendors = await vendorsCollection();
  const users = await usersCollection();
  const now = new Date();

  if (input.addStaffEmail) {
    const staff = await users.findOne({ email: input.addStaffEmail });
    if (!staff) {
      return NextResponse.json(
        { error: "No account with that email — they need to sign up first." },
        { status: 404 },
      );
    }
    const result = await vendors.updateOne(
      { _id: vendorId },
      { $addToSet: { portalUserSubs: staff.authSub }, $set: { updatedAt: now } },
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Café not found" }, { status: 404 });
    }
    // Flag the account as café staff (admins keep their admin role).
    if (staff.role !== "admin") {
      await users.updateOne({ _id: staff._id }, { $set: { role: "cafe", updatedAt: now } });
    }
  }

  if (input.removeStaffSub) {
    await vendors.updateOne(
      { _id: vendorId },
      { $pull: { portalUserSubs: input.removeStaffSub }, $set: { updatedAt: now } },
    );
  }

  const fieldUpdates: Record<string, unknown> = {};
  // The admin UI still speaks v1's active toggle; map it onto the vendor
  // lifecycle (full status controls arrive in Phase B).
  if (input.active !== undefined) fieldUpdates.status = input.active ? "active" : "paused";
  if (input.capacityPerHour !== undefined) fieldUpdates.capacityPerHour = input.capacityPerHour;
  if (Object.keys(fieldUpdates).length > 0) {
    const result = await vendors.updateOne(
      { _id: vendorId },
      { $set: { ...fieldUpdates, updatedAt: now } },
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Café not found" }, { status: 404 });
    }
  }

  return NextResponse.json({ ok: true });
}
