import { NextResponse } from "next/server";
import { z } from "zod";

import { periodSchema } from "@/lib/models/monthly-list";
import { confirmMonthlyList } from "@/lib/monthly-list/service";
import { serializeV1MonthlyList } from "@/lib/v1/data";
import { authenticateV1, v1Error, v1ValidationError } from "@/lib/v1/http";

export const runtime = "nodejs";

const inputSchema = z.object({ period: periodSchema });

/**
 * Confirm a proposed monthly list (Phase D.5 / I.4). On success the system
 * has created a full month of scheduled, vendor-assigned daily orders
 * (critical rule #7 — effective only after confirm). Idempotent (rule #1):
 * `created` vs `duplicates` reports what this call actually scheduled.
 */
export async function POST(request: Request) {
  const auth = await authenticateV1();
  if ("response" in auth) return auth.response;

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return v1ValidationError(parsed.error.issues);

  const result = await confirmMonthlyList(auth.user._id, parsed.data.period);
  if (!result.ok) return v1Error(404, "not_found", "No proposed list for that month.");

  return NextResponse.json({
    created: result.created,
    duplicates: result.duplicates,
    list: await serializeV1MonthlyList(result.list),
  });
}
