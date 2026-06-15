import { NextResponse } from "next/server";

import { rejectUnauthorizedCron } from "@/lib/cron";
import { sweepDailyBatchPayouts } from "@/lib/payments/payout";
import { addDaysLocal, localDateOf } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily payout sweep (Phase E) — scheduled in vercel.json at 15:00 UTC =
 * 23:00 KL, after the day's deliveries. Sweeps each vendor's delivered,
 * charged, unpaid orders into one transfer (daily_batch), and retries any
 * per_order transfers that were deferred because the vendor wasn't yet
 * Connect-ready. Sweeps today and yesterday so late deliveries aren't
 * stranded. Idempotent — safe to re-run (critical rule #1).
 */
export async function GET(request: Request) {
  const rejection = rejectUnauthorizedCron(request);
  if (rejection) return rejection;

  const now = new Date();
  const today = localDateOf(now);
  const yesterday = addDaysLocal(today, -1);

  const summaries = [];
  for (const date of [yesterday, today]) {
    summaries.push(await sweepDailyBatchPayouts(date, now));
  }

  console.log("payouts:", JSON.stringify(summaries));
  return NextResponse.json({ summaries });
}
