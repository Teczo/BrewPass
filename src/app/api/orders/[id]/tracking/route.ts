import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { deliveriesCollection, ordersCollection } from "@/lib/collections";
import { refreshTrackingLocation } from "@/lib/courier/service";
import { deliveryProvider } from "@/lib/models";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Driver location older than this is refreshed from the courier on read. */
const STALE_LOCATION_MS = 20_000;

/**
 * In-app delivery tracking (v2.1) for the order's owner. Returns the driver's
 * latest position and details for the in-app map, plus the provider share link
 * as a fallback. Best-effort refreshes the position from the courier when it's
 * stale, so the customer never leaves BrewPass to track their coffee.
 */
export async function GET(_request: Request, context: RouteContext) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const orderId = new ObjectId(id);

  const orders = await ordersCollection();
  const order = await orders.findOne({ _id: orderId, userId: user._id });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const deliveries = await deliveriesCollection();
  let delivery = await deliveries.findOne({ orderId });

  // Refresh a stale driver position on demand (best-effort; courier only).
  if (
    delivery &&
    deliveryProvider(delivery) !== "manual" &&
    order.status === "out_for_delivery" &&
    (!delivery.driverLocationUpdatedAt ||
      Date.now() - delivery.driverLocationUpdatedAt.getTime() > STALE_LOCATION_MS)
  ) {
    const refreshed = await refreshTrackingLocation(orderId);
    if (refreshed) delivery = await deliveries.findOne({ orderId });
  }

  return NextResponse.json({
    orderStatus: order.status,
    provider: delivery ? deliveryProvider(delivery) : "manual",
    deliveryStatus: delivery?.status ?? null,
    trackingUrl: delivery?.trackingUrl ?? null,
    driver: delivery?.driverName
      ? {
          name: delivery.driverName,
          phone: delivery.driverPhone ?? null,
          plate: delivery.driverPlate ?? null,
        }
      : null,
    driverLocation:
      delivery?.driverLat != null && delivery?.driverLng != null
        ? {
            lat: delivery.driverLat,
            lng: delivery.driverLng,
            updatedAt: delivery.driverLocationUpdatedAt?.toISOString() ?? null,
          }
        : null,
    dropoff: {
      label: order.location.label,
      lat: order.location.geo.lat,
      lng: order.location.geo.lng,
    },
  });
}
