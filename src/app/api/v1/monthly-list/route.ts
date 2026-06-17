import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSubscription } from "@/lib/billing";
import { monthlyListsCollection } from "@/lib/collections";
import { periodSchema } from "@/lib/models/monthly-list";
import { periodOf, proposeMonthlyList } from "@/lib/monthly-list/service";
import { localDateOf } from "@/lib/time";
import { serializeV1MonthlyList } from "@/lib/v1/data";
import { authenticateV1, v1Error, v1ValidationError } from "@/lib/v1/http";

export const runtime = "nodejs";

const proposeSchema = z.object({ period: periodSchema.optional() });

const PROPOSE_ERRORS: Record<string, { status: number; message: string }> = {
  no_subscription: { status: 409, message: "Start a plan before building a monthly list." },
  no_preference: { status: 409, message: "Set your usual drink and schedule first." },
  no_location: { status: 409, message: "Add a default delivery location first." },
  already_confirmed: {
    status: 409,
    message: "This month is already confirmed. Edit individual days instead.",
  },
};

/** The caller's monthly list for a period (defaults to the current KL month). */
export async function GET(request: Request) {
  const auth = await authenticateV1();
  if ("response" in auth) return auth.response;

  const period =
    new URL(request.url).searchParams.get("period") ?? periodOf(localDateOf(new Date()));
  if (!periodSchema.safeParse(period).success) {
    return v1Error(400, "invalid_request", "Invalid period (expected YYYY-MM).");
  }

  const monthlyLists = await monthlyListsCollection();
  const list = await monthlyLists.findOne({ userId: auth.user._id, period });
  if (!list) return NextResponse.json({ list: null });
  return NextResponse.json({ list: await serializeV1MonthlyList(list) });
}

/** Generate (or regenerate) a proposed list for the period (Phase D.5). */
export async function POST(request: Request) {
  const auth = await authenticateV1();
  if ("response" in auth) return auth.response;

  const parsed = proposeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return v1ValidationError(parsed.error.issues);
  const period = parsed.data.period ?? periodOf(localDateOf(new Date()));

  const subscription = await getCurrentSubscription(auth.user._id);
  const result = await proposeMonthlyList(auth.user, subscription, period);
  if (!result.ok) {
    const error = PROPOSE_ERRORS[result.reason];
    return v1Error(error.status, "conflict", error.message);
  }
  return NextResponse.json({ list: await serializeV1MonthlyList(result.list) });
}
