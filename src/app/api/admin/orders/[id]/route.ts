import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { ordersCollection, subscriptionsCollection, vendorsCollection } from "@/lib/collections";
import { adminMarkDelivered, adminRedispatchCourier } from "@/lib/courier/service";
import { refundChargedOrder } from "@/lib/payments/refund";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("force_skip") }),
  z.object({
    action: z.literal("reassign_vendor"),
    vendorId: z.string().regex(/^[0-9a-f]{24}$/i),
  }),
  z.object({ action: z.literal("refund_quota") }),
  z.object({ action: z.literal("refund_charge") }),
  // v2.1 courier overrides for stuck courier orders.
  z.object({ action: z.literal("courier_redispatch") }),
  z.object({ action: z.literal("courier_mark_delivered") }),
]);

/** Return one quota credit, at most once per order (quotaRefundedAt guard). */
async function refundQuotaOnce(orderId: ObjectId, now: Date): Promise<boolean> {
  const orders = await ordersCollection();
  // Claim the refund on the order first — this is the idempotency gate.
  const claimed = await orders.findOneAndUpdate(
    { _id: orderId, confirmedAt: { $exists: true }, quotaRefundedAt: { $exists: false } },
    { $set: { quotaRefundedAt: now, updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!claimed) return false;

  // Office (corporate) orders have no subscription/quota — nothing to credit.
  if (!claimed.subscriptionId) return true;

  const subscriptions = await subscriptionsCollection();
  await subscriptions.updateOne(
    { _id: claimed.subscriptionId, "quota.used": { $gt: 0 } },
    { $inc: { "quota.used": -1 }, $set: { updatedAt: now } },
  );
  return true;
}

/**
 * Manual operator overrides. Money refunds for subscription invoices stay
 * in the Stripe dashboard; in the prepaid model an order "refund" means
 * returning the quota credit.
 */
export async function POST(request: Request, context: RouteContext) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const orderId = new ObjectId(id);

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const now = new Date();
  const orders = await ordersCollection();

  if (input.action === "force_skip") {
    // Pre-cutoff orders just become skipped; locked orders also get their
    // quota credit back (the customer isn't getting a coffee).
    const updated = await orders.findOneAndUpdate(
      { _id: orderId, status: { $in: ["scheduled", "confirmed", "preparing"] } },
      { $set: { status: "skipped", updatedAt: now } },
      { returnDocument: "before" },
    );
    if (!updated) {
      return NextResponse.json(
        { error: "Order not found or already out for delivery." },
        { status: 409 },
      );
    }
    if (updated.status !== "scheduled") {
      await refundQuotaOnce(orderId, now);
    }
    return NextResponse.json({ ok: true });
  }

  if (input.action === "reassign_vendor") {
    const vendors = await vendorsCollection();
    const vendor = await vendors.findOne({ _id: new ObjectId(input.vendorId), status: "active" });
    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found or inactive" }, { status: 404 });
    }
    const result = await orders.updateOne(
      { _id: orderId, status: { $in: ["scheduled", "confirmed", "preparing"] } },
      { $set: { vendorId: vendor._id, updatedAt: now } },
    );
    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: "Order not found or already out for delivery." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (input.action === "courier_redispatch") {
    const result = await adminRedispatchCourier(orderId, now);
    if (!result.ok) {
      return NextResponse.json({ error: `Re-dispatch failed: ${result.reason}` }, { status: 409 });
    }
    return NextResponse.json({ ok: true, outcome: result.outcome });
  }

  if (input.action === "courier_mark_delivered") {
    const result = await adminMarkDelivered(orderId, now);
    if (!result.ok) {
      const message =
        result.reason === "not_out_for_delivery"
          ? "Only an order that's out for delivery can be marked delivered."
          : `Mark delivered failed: ${result.reason}`;
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  if (input.action === "refund_charge") {
    // Phase H: real money refund for a card-on-file charge, reversing the
    // vendor transfer too if it was already paid out.
    const result = await refundChargedOrder(orderId, now);
    if (!result.ok) {
      const message =
        result.reason === "already_refunded"
          ? "This charge was already refunded."
          : result.reason === "not_charged"
            ? "This order has no money charge to refund (prepaid — use Refund quota)."
            : `Refund failed: ${result.reason}`;
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ ok: true, reversedTransfer: result.reversedTransfer });
  }

  // refund_quota
  const refunded = await refundQuotaOnce(orderId, now);
  if (!refunded) {
    return NextResponse.json(
      { error: "Order never consumed quota, or it was already refunded." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
