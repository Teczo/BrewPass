import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { usersCollection } from "@/lib/collections";
import { userRoleSchema } from "@/lib/models";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const updateUserSchema = z
  .object({
    role: userRoleSchema.optional(),
    studentVerified: z.boolean().optional(),
  })
  .refine((value) => value.role !== undefined || value.studentVerified !== undefined, {
    message: "Nothing to update",
  });

export async function PATCH(request: Request, context: RouteContext) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const userId = new ObjectId(id);

  const parsed = updateUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // An admin cannot change their own role — prevents locking yourself out.
  if (parsed.data.role !== undefined && userId.equals(admin._id)) {
    return NextResponse.json({ error: "You can't change your own role." }, { status: 409 });
  }

  const now = new Date();
  const set: Record<string, unknown> = { updatedAt: now };
  const unset: Record<string, ""> = {};
  if (parsed.data.role !== undefined) set.role = parsed.data.role;
  if (parsed.data.studentVerified === true) set.studentVerifiedAt = now;
  if (parsed.data.studentVerified === false) unset.studentVerifiedAt = "";

  const users = await usersCollection();
  const result = await users.updateOne(
    { _id: userId },
    { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) },
  );
  if (result.matchedCount === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
