import { NextResponse } from "next/server";

import { ordersCollection } from "@/lib/collections";
import { orderToJson } from "@/lib/serializers";
import { localDateOf } from "@/lib/time";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

/** The user's orders: everything from today (KL) onward, plus the last 14
 * delivered/skipped days for history. */
export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = localDateOf(new Date());
  const orders = await ordersCollection();
  const docs = await orders.find({ userId: user._id }).sort({ date: -1 }).limit(30).toArray();

  return NextResponse.json({
    today,
    orders: docs.map(orderToJson),
  });
}
