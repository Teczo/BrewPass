import { NextResponse } from "next/server";

import { ordersCollection } from "@/lib/collections";
import { externalIdSchema } from "@/lib/models/shared";
import { vendorExternalIdsByHex } from "@/lib/v1/data";
import { authenticateV1, v1Error } from "@/lib/v1/http";
import { v1Order } from "@/lib/v1/serializers";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ externalId: string }> };

/** A single order by its stable `externalId`, scoped to the caller. */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await authenticateV1();
  if ("response" in auth) return auth.response;

  const { externalId } = await context.params;
  if (!externalIdSchema.safeParse(externalId).success) {
    return v1Error(400, "invalid_request", "Invalid order id.");
  }

  const orders = await ordersCollection();
  const order = await orders.findOne({ externalId, userId: auth.user._id });
  if (!order) return v1Error(404, "not_found", "Order not found.");

  const vendorExternalIds = await vendorExternalIdsByHex([order.vendorId]);
  return NextResponse.json({
    order: v1Order(order, vendorExternalIds.get(order.vendorId.toHexString()) ?? null),
  });
}
