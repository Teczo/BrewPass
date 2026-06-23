import { NextResponse } from "next/server";

import { rejectUnauthorizedCron } from "@/lib/cron";
import { processCutoffs } from "@/lib/order-engine/engine";
import { processPackCutoffs } from "@/lib/promotions/pack-cutoff";

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

  const now = new Date();
  // Phase K.1: charge due Vendor Packs first (one company-card charge each) and
  // materialize their assigned coffees as confirmed/charged orders, so the
  // per-order sweep below doesn't try to charge them individually. Top-up office
  // orders are still scheduled and handled by processCutoffs.
  const packs = await processPackCutoffs(now);
  const summary = await processCutoffs(now);
  console.log("cutoff:", JSON.stringify({ packs, summary }));
  return NextResponse.json({ packs, ...summary });
}
