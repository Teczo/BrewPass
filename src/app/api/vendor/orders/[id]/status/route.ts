import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ordersCollection, usersCollection } from "@/lib/collections";
import { dispatchForHandoff } from "@/lib/courier/service";
import { sendSms } from "@/lib/notifications";
import { refundFailedDelivery } from "@/lib/payments/refund";
import { orderToJson } from "@/lib/serializers";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const statusInputSchema = z.object({
  status: z.enum(["preparing", "out_for_delivery"]),
});

/** Allowed vendor-driven transitions; everything else is rejected. */
const VALID_FROM: Record<string, "confirmed" | "preparing"> = {
  preparing: "confirmed",
  out_for_delivery: "preparing",
};

/**
 * Vendor fulfillment: start preparing a confirmed order, or mark it ready
 * and hand it off to delivery. Updates are scoped to the vendor's own
 * orders and filter on the expected current status, so stale or repeated
 * clicks can't skip steps.
 *
 * On handoff (v2.1) the order is dispatched to a real courier behind the
 * `CourierAdapter` abstraction (or kept on the legacy manual path for vendors
 * who self-deliver). If courier dispatch fails after retries, the order is
 * failed and the day refunded — the chosen dispatch-failure policy — so it
 * never silently stalls.
 */
export async function POST(request: Request, context: RouteContext) {
  const vendorContext = await getCurrentVendorContext();
  if (!vendorContext) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
      vendorId: vendorContext.vendor._id,
      status: VALID_FROM[parsed.data.status],
    },
    { $set: { status: parsed.data.status, updatedAt: now } },
    { returnDocument: "after" },
  );

  if (!updated) {
    return NextResponse.json(
      { error: "Order not found for this vendor, or it isn't in the right state for that step." },
      { status: 409 },
    );
  }

  if (parsed.data.status === "out_for_delivery") {
    // Dispatch a courier (or create the manual delivery). Idempotent on
    // orderId — re-clicks/retries never double-dispatch.
    const outcome = await dispatchForHandoff(updated, vendorContext.vendor, now);

    if (outcome.status === "failed") {
      // No courier after retries → fail the order and refund the day.
      await orders.updateOne(
        { _id: updated._id, status: "out_for_delivery" },
        {
          $set: {
            status: "failed",
            failureReason: `courier_dispatch_failed: ${outcome.reason}`.slice(0, 300),
            updatedAt: now,
          },
        },
      );
      try {
        await refundFailedDelivery(updated._id, now);
      } catch (error) {
        console.error(`Refund after dispatch failure ${updated._id.toHexString()} failed:`, error);
      }
      return NextResponse.json(
        {
          error:
            "Couldn't dispatch a courier for this order. It was cancelled and the customer refunded.",
        },
        { status: 502 },
      );
    }

    // Optional SMS — best-effort, never blocks the handoff.
    const users = await usersCollection();
    const customer = await users.findOne({ _id: updated.userId });
    if (customer?.phone) {
      try {
        await sendSms(
          customer.phone,
          `BrewPass: your ${updated.drink.drink} is on its way to ${updated.location.label}.`,
        );
      } catch (error) {
        console.error("Out-for-delivery SMS failed:", error);
      }
    }
  }

  return NextResponse.json({ order: orderToJson(updated) });
}
