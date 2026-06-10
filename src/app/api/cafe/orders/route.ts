import { NextResponse } from "next/server";

import { getCurrentCafeContext } from "@/lib/cafes";
import { ordersCollection, usersCollection } from "@/lib/collections";
import { localDateSchema } from "@/lib/models";
import { orderToJson } from "@/lib/serializers";
import { localDateOf } from "@/lib/time";

export const runtime = "nodejs";

/**
 * The café's order queue for a given KL date (default today): everything
 * locked at cutoff onward. Scheduled orders are excluded — they can still
 * change or be skipped until 6 AM.
 */
export async function GET(request: Request) {
  const context = await getCurrentCafeContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date") ?? localDateOf(new Date());
  const parsedDate = localDateSchema.safeParse(dateParam);
  if (!parsedDate.success) {
    return NextResponse.json({ error: "Invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }

  const orders = await ordersCollection();
  const docs = await orders
    .find({
      cafeId: context.cafe._id,
      date: parsedDate.data,
      status: { $in: ["confirmed", "preparing", "out_for_delivery", "delivered"] },
    })
    .sort({ deliverAt: 1 })
    .toArray();

  // Attach customer display names for the preparation labels.
  const users = await usersCollection();
  const customers = await users
    .find({ _id: { $in: docs.map((doc) => doc.userId) } })
    .project<{ _id: (typeof docs)[number]["userId"]; name: string }>({ name: 1 })
    .toArray();
  const nameById = new Map(
    customers.map((customer) => [customer._id.toHexString(), customer.name]),
  );

  return NextResponse.json({
    date: parsedDate.data,
    cafe: { id: context.cafe._id.toHexString(), name: context.cafe.name },
    orders: docs.map((doc) => ({
      ...orderToJson(doc),
      customerName: nameById.get(doc.userId.toHexString()) ?? "Customer",
    })),
  });
}
