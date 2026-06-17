import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { migratePhaseIDown, migratePhaseIUp } from "@/lib/migrations/phase-i-external-id";

export const runtime = "nodejs";

const inputSchema = z.object({ direction: z.enum(["up", "down"]) });

/**
 * Phase I.2/I.3 data migration (backfill externalId + tenantId). `up` is
 * idempotent and safe to re-run; `down` removes the reserved fields and
 * should only be used together with a rollback of the Phase I code.
 */
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const summary =
    parsed.data.direction === "up" ? await migratePhaseIUp() : await migratePhaseIDown();
  return NextResponse.json(summary);
}
