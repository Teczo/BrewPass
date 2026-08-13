import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { migratePhaseMDown, migratePhaseMUp } from "@/lib/migrations/phase-m-vendor-market";

export const runtime = "nodejs";

const inputSchema = z.object({ direction: z.enum(["up", "down"]) });

/**
 * Phase M data migration (backfill `Vendor.market = "MY"`). `up` is idempotent
 * and never reclassifies an admin-set AU vendor; `down` clears the field and
 * should only be used together with a rollback of the Phase M code.
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
    parsed.data.direction === "up" ? await migratePhaseMUp() : await migratePhaseMDown();
  return NextResponse.json(summary);
}
