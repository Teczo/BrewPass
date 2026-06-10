import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentCafeContext } from "@/lib/cafes";
import { deliveriesCollection, ordersCollection } from "@/lib/collections";
import { orderToJson } from "@/lib/serializers";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const statusInputSchema = z.object({
  status: z.enum(["preparing", "out_for_delivery"]),
});

/** Allowed café-driven transitions; everything else is rejected. */
const VALID_FROM: Record<string, "confirmed" | "preparing"> = {
  preparing: "confirmed",
  out_for_delivery: "preparing",
};

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

/**
 * Café fulfillment: start preparing a confirmed order, or mark it ready
 * and hand it off to delivery. Updates are scoped to the café's own
 * orders and filter on the expected current status, so stale or repeated
 * clicks can't skip steps.
 */
export async function POST(request: Request, context: RouteContext) {
  const cafeContext = await getCurrentCafeContext();
  if (!cafeContext) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const parsed = statusInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const now = new Date();
  const orders = await ordersCollection();
  const updated = await orders.findOneAndUpdate(
    {
      _id: new ObjectId(id),
      cafeId: cafeContext.cafe._id,
      status: VALID_FROM[parsed.data.status],
    },
    { $set: { status: parsed.data.status, updatedAt: now } },
    { returnDocument: "after" },
  );

  if (!updated) {
    return NextResponse.json(
      { error: "Order not found for this café, or it isn't in the right state for that step." },
      { status: 409 },
    );
  }

  // Handoff creates the Delivery record (rider assignment is a manual
  // step until Phase 5 tooling). Unique on orderId — re-clicks are no-ops.
  if (parsed.data.status === "out_for_delivery") {
    const deliveries = await deliveriesCollection();
    try {
      await deliveries.insertOne({
        _id: new ObjectId(),
        orderId: updated._id,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  return NextResponse.json({ order: orderToJson(updated) });
}
