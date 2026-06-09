import { NextResponse } from "next/server";

/**
 * Authenticate Vercel Cron invocations: Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
 * Returns a response to short-circuit with, or null when authorized.
 */
export function rejectUnauthorizedCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
