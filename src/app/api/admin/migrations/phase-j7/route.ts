import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { migratePhaseJ7Down, migratePhaseJ7Up } from "@/lib/migrations/phase-j7-order-source";

export const runtime = "nodejs";

const inputSchema = z.object({ direction: z.enum(["up", "down"]) });

/**
 * Phase J.7 data migration: backfill order `source` and swap the unique index
 * from `{ userId, date }` to `{ userId, date, source }`. `up` is idempotent and
 * safe to re-run; `down` should only be used with a rollback of the Phase J.7
 * code and only while no office orders exist.
 */
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const summary =
    parsed.data.direction === "up" ? await migratePhaseJ7Up() : await migratePhaseJ7Down();
  return NextResponse.json(summary);
}
