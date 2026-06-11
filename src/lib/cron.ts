import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

/**
 * Authenticate Vercel Cron invocations: Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
 * Comparison is constant-time. Returns a response to short-circuit
 * with, or null when authorized.
 */
export function rejectUnauthorizedCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }

  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  const authorized = provided.length === expected.length && timingSafeEqual(provided, expected);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
