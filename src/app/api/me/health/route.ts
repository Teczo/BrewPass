import { NextResponse } from "next/server";
import { z } from "zod";

import { usersCollection } from "@/lib/collections";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const inputSchema = z.object({ optIn: z.boolean() });

/** Toggle the opt-in for caffeine/sugar insights. */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const now = new Date();
  const users = await usersCollection();
  await users.updateOne(
    { _id: user._id },
    parsed.data.optIn
      ? { $set: { healthOptInAt: now, updatedAt: now } }
      : { $unset: { healthOptInAt: "" }, $set: { updatedAt: now } },
  );
  return NextResponse.json({ ok: true, optedIn: parsed.data.optIn });
}
