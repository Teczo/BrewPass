import { NextResponse } from "next/server";
import { z } from "zod";

import { usersCollection } from "@/lib/collections";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const tokenSchema = z.object({ token: z.string().min(20).max(4096) });

/** Register a device's FCM token for push notifications. */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = tokenSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const users = await usersCollection();
  await users.updateOne(
    { _id: user._id },
    { $addToSet: { fcmTokens: parsed.data.token }, $set: { updatedAt: new Date() } },
  );
  return NextResponse.json({ ok: true });
}

/** Remove a token (logout / token rotation). */
export async function DELETE(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = tokenSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const users = await usersCollection();
  await users.updateOne(
    { _id: user._id },
    { $pull: { fcmTokens: parsed.data.token }, $set: { updatedAt: new Date() } },
  );
  return NextResponse.json({ ok: true });
}
