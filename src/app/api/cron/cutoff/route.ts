import { NextResponse } from "next/server";

import { rejectUnauthorizedCron } from "@/lib/cron";
import { processCutoffs } from "@/lib/order-engine/engine";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cutoff job — scheduled in vercel.json at 22:00 UTC = 06:00 KL (the
 * cutoff for the KL day that is just starting). Locks every scheduled
 * order whose cutoff has passed and decrements plan quota exactly once
 * per order. Safe to re-run.
 */
export async function GET(request: Request) {
  const rejection = rejectUnauthorizedCron(request);
  if (rejection) return rejection;

  const summary = await processCutoffs(new Date());
  console.log("cutoff:", JSON.stringify(summary));
  return NextResponse.json(summary);
}
