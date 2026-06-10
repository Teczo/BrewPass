import { NextResponse } from "next/server";

import { getCurrentAdmin } from "@/lib/admin";
import { ensureIndexes } from "@/lib/collections";

export const runtime = "nodejs";

/**
 * One-click database setup: creates every index the app relies on
 * (including the unique keys that make order generation and webhook
 * handling idempotent). Idempotent itself — safe to run repeatedly.
 */
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureIndexes();
  return NextResponse.json({ ok: true });
}
