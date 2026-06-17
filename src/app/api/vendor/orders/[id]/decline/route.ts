import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { ordersCollection } from "@/lib/collections";
import { loadRoutingCandidates, selectVendor } from "@/lib/order-engine/routing-data";
import { recordDecline } from "@/lib/quality-service";
import { isoWeekdayOf, localDateOf, localTimeOf } from "@/lib/time";
import { getCurrentVendorContext } from "@/lib/vendors";
import { vendorExternalIdsByHex } from "@/lib/v1/data";
import { emitOrderEvent } from "@/lib/webhooks/emit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Vendor declines an assigned-but-not-yet-locked order. Auto-accept is the
 * default (confirmed product decision): an order stands unless the vendor
 * declines before the 6 AM cutoff. On decline the routing engine reassigns
 * to the next-best eligible vendor (excluding everyone who has declined);
 * if none remain the order fails (no quota was consumed pre-cutoff). The
 * routing decision is server-only (critical rule #2) and reads the order's
 * snapshot, never live preferences (critical rule #4).
 */
export async function POST(request: Request, context: RouteContext) {
  const vendorContext = await getCurrentVendorContext();
  if (!vendorContext) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const orderId = new ObjectId(id);
  const vendorId = vendorContext.vendor._id;

  const orders = await ordersCollection();
  const now = new Date();

  // Only a still-scheduled order assigned to this vendor, before its cutoff,
  // can be declined.
  const order = await orders.findOne({
    _id: orderId,
    vendorId,
    status: "scheduled",
    cutoffAt: { $gt: now },
  });
  if (!order) {
    return NextResponse.json(
      { error: "Order not found for this vendor, or it's already locked." },
      { status: 409 },
    );
  }

  const declinedVendorIds = [...(order.declinedVendorIds ?? []), vendorId];
  const candidates = await loadRoutingCandidates(order.date);
  const result = selectVendor(
    {
      preferredVendorId: null, // a decline always re-routes to a different vendor
      point: order.location.geo,
      date: order.date,
      weekday: isoWeekdayOf(order.date),
      time: localTimeOf(order.deliverAt),
      drink: { drink: order.drink.drink, milk: order.drink.milk },
      // Same-day reassignment honours each vendor's accept-cutoff (Phase F).
      nowLocalDate: localDateOf(now),
      nowLocalTime: localTimeOf(now),
      excludeVendorIds: declinedVendorIds,
    },
    candidates,
  );

  // Re-claim with the same guard so a racing cutoff/decline can't double-act.
  const guard = { _id: orderId, vendorId, status: "scheduled" as const, cutoffAt: { $gt: now } };

  if (!result.ok) {
    const failed = await orders.updateOne(guard, {
      $set: {
        status: "failed",
        failureReason: "vendor_declined_no_alternative",
        declinedVendorIds,
        updatedAt: now,
      },
    });
    // Count the decline only when our claim actually applied (Phase G).
    if (failed.matchedCount === 1) await recordDecline(vendorId, now);
    return NextResponse.json({ ok: true, reassigned: false });
  }

  const updated = await orders.updateOne(guard, {
    $set: {
      vendorId: result.vendorId,
      assignmentMethod: "reassigned" as const,
      declinedVendorIds,
      updatedAt: now,
    },
  });
  if (updated.matchedCount === 0) {
    return NextResponse.json(
      { error: "Order changed before the decline could be applied." },
      { status: 409 },
    );
  }

  await recordDecline(vendorId, now); // Phase G acceptance metric

  // Phase I.5: best-effort outbound event for the new assignment. The new
  // vendor is part of the idempotency key so each reassignment is distinct.
  const newVendorExternalId = await vendorExternalIdsByHex([result.vendorId]);
  const ext = newVendorExternalId.get(result.vendorId.toHexString()) ?? null;
  await emitOrderEvent(
    "vendor.assigned",
    { ...order, vendorId: result.vendorId, assignmentMethod: "reassigned" },
    now,
    { vendorExternalIdHint: ext, suffix: ext ?? result.vendorId.toHexString() },
  );

  return NextResponse.json({ ok: true, reassigned: true });
}
