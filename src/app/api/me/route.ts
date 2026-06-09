import { NextResponse } from "next/server";

import { usersCollection } from "@/lib/collections";
import { userToJson } from "@/lib/serializers";
import { getOnboardingStatus, getOrCreateCurrentUser } from "@/lib/users";
import { profileInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const onboarding = await getOnboardingStatus(user);
  return NextResponse.json({ user: userToJson(user), onboarding });
}

export async function PATCH(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = profileInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const users = await usersCollection();
  const updated = await users.findOneAndUpdate(
    { _id: user._id },
    { $set: { ...parsed.data, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ user: userToJson(updated) });
}
