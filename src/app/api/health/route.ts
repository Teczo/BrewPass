import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness check: verifies the app is up and can reach MongoDB. */
export async function GET() {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return NextResponse.json({ ok: true, db: "up" });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
