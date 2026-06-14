import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { migratePhaseCDown, migratePhaseCUp } from "@/lib/migrations/phase-c-taxonomy";

export const runtime = "nodejs";

const inputSchema = z.object({ direction: z.enum(["up", "down"]) });

/**
 * Phase C data migration: seed the OptionTaxonomy and absorb legacy
 * preference values. `up` is idempotent and safe to re-run; `down` clears
 * the taxonomy and is only for rolling back together with v1-style code.
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
    parsed.data.direction === "up" ? await migratePhaseCUp() : await migratePhaseCDown();
  return NextResponse.json(summary);
}
