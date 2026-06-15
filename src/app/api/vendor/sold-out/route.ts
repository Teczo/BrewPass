import { NextResponse } from "next/server";
import { z } from "zod";

import { vendorsCollection } from "@/lib/collections";
import { getCurrentVendorContext } from "@/lib/vendors";
import { localDateOf } from "@/lib/time";

export const runtime = "nodejs";

const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  soldOut: z.boolean(),
});

/**
 * Mark a delivery date sold out (or available again) — the quick "sold out
 * today" control (Phase F). Routing skips sold-out dates. Past dates are
 * pruned on every write so the list stays self-cleaning; a date can only be
 * marked sold out from today onward.
 */
export async function POST(request: Request) {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { date, soldOut } = parsed.data;
  const today = localDateOf(new Date());
  if (date < today) {
    return NextResponse.json({ error: "Can't change a past date." }, { status: 400 });
  }

  const current = (context.vendor.soldOutDates ?? []).filter((d) => d >= today);
  const next = new Set(current);
  if (soldOut) next.add(date);
  else next.delete(date);

  const vendors = await vendorsCollection();
  await vendors.updateOne(
    { _id: context.vendor._id },
    { $set: { soldOutDates: [...next].sort(), updatedAt: new Date() } },
  );

  return NextResponse.json({ soldOutDates: [...next].sort() });
}
