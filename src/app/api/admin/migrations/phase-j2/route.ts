import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import {
  migratePhaseJ2Down,
  migratePhaseJ2Up,
} from "@/lib/migrations/phase-j2-preference-scope";

export const runtime = "nodejs";

const inputSchema = z.object({ direction: z.enum(["up", "down"]) });

/**
 * Phase J.2 data migration: backfill preference `scope` and swap the unique
 * index from `{ userId }` to `{ userId, scope }`. `up` is idempotent and safe
 * to re-run; `down` should only be used with a rollback of the Phase J.2 code
 * and only while no office preferences exist.
 */
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const summary =
    parsed.data.direction === "up" ? await migratePhaseJ2Up() : await migratePhaseJ2Down();
  return NextResponse.json(summary);
}
