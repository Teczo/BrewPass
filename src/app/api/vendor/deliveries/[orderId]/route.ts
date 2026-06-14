import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { deliveriesCollection, ordersCollection, usersCollection } from "@/lib/collections";
import { sendSms } from "@/lib/notifications";
import { handleOrderDelivered } from "@/lib/payments/payout";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ orderId: string }> };

const actionSchema = z.discriminatedUnion("action", [
  // Rider assignment is manual for MVP: a free-form name/identifier.
  z.object({ action: z.literal("assign"), riderId: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("delivered") }),
  z.object({ action: z.literal("failed"), reason: z.string().trim().min(1).max(300) }),
]);

/**
 * Delivery lifecycle, driven from the vendor portal for MVP. The delivery
 * record was created at handoff; this assigns a rider, completes, or
 * fails it — keeping the order document in sync so the customer's
 * dashboard reflects the same state.
 */
export async function POST(request: Request, context: RouteContext) {
  const vendorContext = await getCurrentVendorContext();
  if (!vendorContext) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { orderId } = await context.params;
  if (!ObjectId.isValid(orderId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const orders = await ordersCollection();
  const order = await orders.findOne({
    _id: new ObjectId(orderId),
    vendorId: vendorContext.vendor._id,
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found for this vendor" }, { status: 404 });
  }
  if (order.status !== "out_for_delivery") {
    return NextResponse.json(
      { error: "This order hasn't been handed off to delivery yet." },
      { status: 409 },
    );
  }

  const now = new Date();
  const deliveries = await deliveriesCollection();
  const input = parsed.data;

  if (input.action === "assign") {
    const updated = await deliveries.findOneAndUpdate(
      { orderId: order._id, status: { $in: ["pending", "assigned"] } },
      {
        $set: {
          riderId: input.riderId,
          status: "assigned",
          assignedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      return NextResponse.json(
        { error: "Delivery is already completed or failed." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, delivery: { status: updated.status } });
  }

  if (input.action === "delivered") {
    const updated = await deliveries.findOneAndUpdate(
      { orderId: order._id, status: { $in: ["pending", "assigned", "picked_up"] } },
      {
        $set: {
          status: "delivered",
          deliveredAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      return NextResponse.json(
        { error: "Delivery is already completed or failed." },
        { status: 409 },
      );
    }
    await orders.updateOne(
      { _id: order._id, status: "out_for_delivery" },
      { $set: { status: "delivered", updatedAt: now } },
    );

    // Phase E: release the vendor's payout now that delivery is confirmed
    // (delivery-gated, rule #4). Best-effort — a per_order transfer hiccup
    // leaves the order `pending` for the daily sweep to retry; it must never
    // block the delivery transition.
    try {
      await handleOrderDelivered(order._id, now);
    } catch (error) {
      console.error(`Payout on delivery for order ${order._id.toHexString()} failed:`, error);
    }

    // Optional SMS — best-effort, never blocks the transition.
    const users = await usersCollection();
    const customer = await users.findOne({ _id: order.userId });
    if (customer?.phone) {
      try {
        await sendSms(
          customer.phone,
          `BrewPass: your ${order.drink.drink} has been delivered to ${order.location.label}. Enjoy! ☕`,
        );
      } catch (error) {
        console.error("Delivered SMS failed:", error);
      }
    }
    return NextResponse.json({ ok: true, delivery: { status: "delivered" } });
  }

  // failed
  const updated = await deliveries.findOneAndUpdate(
    { orderId: order._id, status: { $in: ["pending", "assigned", "picked_up"] } },
    {
      $set: {
        status: "failed",
        failureReason: input.reason,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    return NextResponse.json(
      { error: "Delivery is already completed or failed." },
      { status: 409 },
    );
  }
  await orders.updateOne(
    { _id: order._id, status: "out_for_delivery" },
    {
      $set: { status: "failed", failureReason: `delivery_failed: ${input.reason}`, updatedAt: now },
    },
  );
  return NextResponse.json({ ok: true, delivery: { status: "failed" } });
}
