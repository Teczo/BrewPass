import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ordersCollection, ratingsCollection } from "@/lib/collections";
import { newDocumentMeta } from "@/lib/models";
import { recordRating } from "@/lib/quality-service";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const inputSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

/**
 * Post-delivery rating (Phase G). The subscriber rates their own delivered
 * order exactly once (unique on orderId). The rating aggregates into the
 * vendor's ratingScore and feeds the routing quality tiebreak + auto-suspend.
 */
export async function POST(request: Request, context: RouteContext) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const orders = await ordersCollection();
  const order = await orders.findOne({ _id: new ObjectId(id), userId: user._id });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "delivered") {
    return NextResponse.json({ error: "You can only rate a delivered order." }, { status: 409 });
  }

  const now = new Date();
  const ratings = await ratingsCollection();
  try {
    await ratings.insertOne({
      _id: new ObjectId(),
      ...newDocumentMeta(),
      orderId: order._id,
      userId: user._id,
      vendorId: order.vendorId,
      score: parsed.data.score,
      ...(parsed.data.comment ? { comment: parsed.data.comment } : {}),
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return NextResponse.json({ error: "You've already rated this order." }, { status: 409 });
    }
    throw error;
  }

  await recordRating(order.vendorId, parsed.data.score, now);
  return NextResponse.json({ ok: true, score: parsed.data.score });
}
