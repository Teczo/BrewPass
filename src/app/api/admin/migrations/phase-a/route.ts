import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { migratePhaseADown, migratePhaseAUp } from "@/lib/migrations/phase-a-vendor-scope";

export const runtime = "nodejs";

const inputSchema = z.object({ direction: z.enum(["up", "down"]) });

/**
 * Phase A data migration (cafés → vendors). `up` is idempotent and safe to
 * re-run; `down` rolls the data back to the v1 shape and should only be
 * used together with a rollback to v1 code.
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
    parsed.data.direction === "up" ? await migratePhaseAUp() : await migratePhaseADown();
  return NextResponse.json(summary);
}
