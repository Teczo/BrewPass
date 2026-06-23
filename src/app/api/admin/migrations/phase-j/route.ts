import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { migratePhaseJDown, migratePhaseJUp } from "@/lib/migrations/phase-j-membership";

export const runtime = "nodejs";

const inputSchema = z.object({ direction: z.enum(["up", "down"]) });

/**
 * Phase J.0 data migration: backfill `CorporateMembership` rows from
 * `memberUserIds` and decouple membership from `User.role`. `up` is idempotent
 * and safe to re-run; `down` removes the migrated memberships and re-flags
 * members `corporate`, and should only be used with a rollback of the Phase J
 * code.
 */
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  const summary =
    parsed.data.direction === "up" ? await migratePhaseJUp() : await migratePhaseJDown();
  return NextResponse.json(summary);
}
