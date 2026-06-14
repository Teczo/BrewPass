import { NextResponse } from "next/server";
import { z } from "zod";

import { confirmMonthlyList, vendorNamesForList } from "@/lib/monthly-list/service";
import { monthlyListToJson } from "@/lib/serializers";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const inputSchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) });

/**
 * Confirm a proposed monthly list. On success the system has created a full
 * month of scheduled, vendor-assigned daily orders (critical rule #7 —
 * effective only after the user confirms). Idempotent (critical rule #1).
 */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await confirmMonthlyList(user._id, parsed.data.period);
  if (!result.ok) {
    return NextResponse.json({ error: "No proposed list for that month." }, { status: 404 });
  }
  return NextResponse.json({
    created: result.created,
    duplicates: result.duplicates,
    list: monthlyListToJson(result.list, await vendorNamesForList(result.list)),
  });
}
