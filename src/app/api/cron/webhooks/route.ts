import { NextResponse } from "next/server";

import { rejectUnauthorizedCron } from "@/lib/cron";
import { processWebhookRetries } from "@/lib/webhooks/dispatch";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Outbound webhook delivery sweep (Phase I.5). Emission enqueues delivery
 * rows inside core flows without ever making an outbound request; this job
 * does the actual signed HTTP delivery and retries failures with exponential
 * backoff. Idempotent and safe to re-run — each row leases itself before an
 * attempt and the (subscriptionId, eventId) uniqueness prevents duplicates.
 */
export async function GET(request: Request) {
  const rejection = rejectUnauthorizedCron(request);
  if (rejection) return rejection;

  const summary = await processWebhookRetries(new Date());
  console.log("webhooks:", JSON.stringify(summary));
  return NextResponse.json(summary);
}
