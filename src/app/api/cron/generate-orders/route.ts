import { NextResponse } from "next/server";

import { generateOfficeOrdersForDate } from "@/lib/corporate/office-orders";
import { reconcileOverlapsForDate } from "@/lib/corporate/overlap";
import { rejectUnauthorizedCron } from "@/lib/cron";
import { generateOrdersForDate, notifyOrdersForDate } from "@/lib/order-engine/engine";
import { tomorrowLocalDate } from "@/lib/time";

export const runtime = "nodejs";
// Generation walks every active subscription; give it room.
export const maxDuration = 300;

/**
 * Nightly job — scheduled in vercel.json at 12:00 UTC = 20:00 KL.
 * Generates tomorrow's orders, then sends the night-before notifications.
 * Safe to re-run: generation is keyed on (userId, date) and notification
 * on notifiedAt.
 */
export async function GET(request: Request) {
  const rejection = rejectUnauthorizedCron(request);
  if (rejection) return rejection;

  const now = new Date();
  const date = tomorrowLocalDate(now);
  const generation = await generateOrdersForDate(date, now);
  // Phase J.7: office (corporate) orders, generated after personal so the
  // notification pass below covers both.
  const officeGeneration = await generateOfficeOrdersForDate(date, now);
  // Phase J.5: apply members' standing personal/office overlap rules now that
  // both sides exist — skips at most one side per the member's own rule, before
  // the night-before notification goes out. Members without a rule keep both.
  const overlap = await reconcileOverlapsForDate(date, now);
  const notification = await notifyOrdersForDate(date, now);

  console.log(
    "generate-orders:",
    JSON.stringify({ generation, officeGeneration, overlap, notification }),
  );
  return NextResponse.json({ generation, officeGeneration, overlap, notification });
}
