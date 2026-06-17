import { NextResponse } from "next/server";

import { ordersCollection } from "@/lib/collections";
import { localDateOf } from "@/lib/time";
import { vendorExternalIdsByHex } from "@/lib/v1/data";
import { authenticateV1 } from "@/lib/v1/http";
import { v1Order } from "@/lib/v1/serializers";

export const runtime = "nodejs";

/**
 * The subscriber's orders (Phase I.4) — mirrors the internal listing: most
 * recent first, capped. Vendor references are rendered as vendor
 * `externalId`s (critical rule #14).
 */
export async function GET() {
  const auth = await authenticateV1();
  if ("response" in auth) return auth.response;

  const orders = await ordersCollection();
  const docs = await orders.find({ userId: auth.user._id }).sort({ date: -1 }).limit(30).toArray();

  const vendorExternalIds = await vendorExternalIdsByHex(docs.map((order) => order.vendorId));

  return NextResponse.json({
    today: localDateOf(new Date()),
    orders: docs.map((order) =>
      v1Order(order, vendorExternalIds.get(order.vendorId.toHexString()) ?? null),
    ),
  });
}
