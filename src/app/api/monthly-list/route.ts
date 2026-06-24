import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSubscription } from "@/lib/billing";
import { monthlyListsCollection } from "@/lib/collections";
import { drinkSpecSchema } from "@/lib/models/shared";
import {
  editMonthlyList,
  periodOf,
  proposeMonthlyList,
  vendorNamesForList,
} from "@/lib/monthly-list/service";
import { monthlyListToJson } from "@/lib/serializers";
import { localDateOf } from "@/lib/time";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const periodSchema = z.string().regex(/^\d{4}-\d{2}$/);

const priorityField = z.number().int().min(0).max(3);
const proposeSchema = z.object({
  period: periodSchema.optional(),
  /** Questionnaire priorities — when present, the AI varies the coffee and
   * vendor per day; absent, the plan repeats the user's usual. */
  priorities: z
    .object({
      proximity: priorityField,
      price: priorityField,
      speed: priorityField,
      rating: priorityField,
      drink: priorityField,
    })
    .optional(),
});

const editSchema = z.object({
  period: periodSchema,
  edits: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        drink: drinkSpecSchema.optional(),
        vendorId: z
          .string()
          .regex(/^[0-9a-f]{24}$/i)
          .nullable()
          .optional(),
        skipped: z.boolean().optional(),
      }),
    )
    .min(1),
});

const PROPOSE_ERRORS: Record<string, { status: number; message: string }> = {
  no_subscription: { status: 409, message: "Start a plan before building a monthly list." },
  no_preference: { status: 409, message: "Set your usual drink and schedule first." },
  no_location: { status: 409, message: "Add a default delivery location first." },
  already_confirmed: {
    status: 409,
    message: "This month is already confirmed. Edit individual days from your dashboard.",
  },
};

/** Fetch the user's list for a period (defaults to the current KL month). */
export async function GET(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? periodOf(localDateOf(new Date()));
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  const monthlyLists = await monthlyListsCollection();
  const list = await monthlyLists.findOne({ userId: user._id, period });
  if (!list) return NextResponse.json({ list: null });
  return NextResponse.json({ list: monthlyListToJson(list, await vendorNamesForList(list)) });
}

/** Generate (or regenerate) a proposed list for the period. */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = proposeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const period = parsed.data.period ?? periodOf(localDateOf(new Date()));

  const subscription = await getCurrentSubscription(user._id);
  const result = await proposeMonthlyList(user, subscription, period, {
    priorities: parsed.data.priorities,
  });
  if (!result.ok) {
    const error = PROPOSE_ERRORS[result.reason];
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({
    list: monthlyListToJson(result.list, await vendorNamesForList(result.list)),
  });
}

/** Edit days on a proposed list (swap vendor, change drink, skip). */
export async function PATCH(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = editSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await editMonthlyList(user._id, parsed.data.period, parsed.data.edits);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    const message =
      result.reason === "invalid_vendor"
        ? "One of the chosen vendors is unavailable."
        : result.reason === "invalid_date"
          ? "An edit referenced a day not in this list."
          : result.reason === "already_confirmed"
            ? "This month is confirmed; edit individual days instead."
            : "No proposed list for that month.";
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({
    list: monthlyListToJson(result.list, await vendorNamesForList(result.list)),
  });
}
