import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { commissionConfigCollection } from "@/lib/collections";
import { getPlatformCommissionBps } from "@/lib/payments/commission";
import { PLATFORM_DEFAULT_COMMISSION_BPS } from "@/lib/payments/money";

export const runtime = "nodejs";

const inputSchema = z.object({
  /** Platform default commission in basis points (0–10000; 2000 = 20%). */
  defaultRateBps: z.number().int().min(0).max(10_000),
});

/** Current platform default commission (Phase H). */
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    defaultRateBps: await getPlatformCommissionBps(),
    codeDefaultBps: PLATFORM_DEFAULT_COMMISSION_BPS,
  });
}

/** Set the platform default commission rate (Phase H). Upserts the singleton. */
export async function PUT(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const now = new Date();
  const config = await commissionConfigCollection();
  await config.updateOne(
    { key: "platform" },
    {
      $set: { defaultRateBps: parsed.data.defaultRateBps, updatedAt: now },
      $setOnInsert: { _id: new ObjectId(), key: "platform" as const, createdAt: now },
    },
    { upsert: true },
  );
  return NextResponse.json({ defaultRateBps: parsed.data.defaultRateBps });
}
