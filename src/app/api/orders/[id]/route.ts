import { ObjectId, type UpdateFilter } from "mongodb";
import { NextResponse } from "next/server";

import { resolveAddOns } from "@/lib/addons";
import { getCurrentSubscription } from "@/lib/billing";
import { locationsCollection, ordersCollection } from "@/lib/collections";
import type { Order } from "@/lib/models";
import { orderToJson } from "@/lib/serializers";
import { findUncoveredDrinkField, loadDrinkValueSets } from "@/lib/taxonomy";
import { getOrCreateCurrentUser } from "@/lib/users";
import { orderActionSchema } from "@/lib/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Modification window: change drink/location, skip, or unskip — only while
 * the order is still before its cutoff. Every update filters on status AND
 * cutoffAt in the database itself, so a request racing the cutoff job can
 * never modify a locked order (critical rule #2: server-authoritative).
 */
export async function PATCH(request: Request, context: RouteContext) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const orderId = new ObjectId(id);

  const parsed = orderActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const now = new Date();
  const orders = await ordersCollection();
  const input = parsed.data;

  let fromStatus: Order["status"];
  let update: UpdateFilter<Order>;

  if (input.action === "skip") {
    fromStatus = "scheduled";
    update = { $set: { status: "skipped", modifiedByUserAt: now, updatedAt: now } };
  } else if (input.action === "unskip") {
    fromStatus = "skipped";
    update = { $set: { status: "scheduled", modifiedByUserAt: now, updatedAt: now } };
  } else {
    fromStatus = "scheduled";
    const set: Record<string, unknown> = { modifiedByUserAt: now, updatedAt: now };
    if (input.drink) {
      // Modified drinks must also reference the taxonomy (critical rule #3).
      const uncovered = findUncoveredDrinkField(await loadDrinkValueSets(), input.drink);
      if (uncovered) {
        return NextResponse.json(
          { error: `"${uncovered.value}" isn't an available ${uncovered.field} option.` },
          { status: 422 },
        );
      }
      set.drink = input.drink;
    }
    if (input.addOnKeys !== undefined) {
      const addOns = resolveAddOns(input.addOnKeys);
      if (!addOns) {
        return NextResponse.json({ error: "Unknown add-on selected" }, { status: 422 });
      }
      if (addOns.length > 0) {
        // Add-ons are charged to the member's own saved card at cutoff —
        // corporate seats bill to the company and can't buy extras here.
        const subscription = await getCurrentSubscription(user._id);
        if (subscription?.plan === "corporate") {
          return NextResponse.json(
            { error: "Add-ons aren't available on corporate plans yet." },
            { status: 409 },
          );
        }
      }
      set.addOns = addOns;
    }
    if (input.locationId) {
      // Re-snapshot from one of the user's own saved locations.
      const locations = await locationsCollection();
      const location = await locations.findOne({
        _id: new ObjectId(input.locationId),
        userId: user._id,
      });
      if (!location) {
        return NextResponse.json({ error: "Location not found" }, { status: 422 });
      }
      set.location = {
        locationId: location._id,
        label: location.label,
        address: location.address,
        geo: { ...location.geo },
        ...(location.notes ? { notes: location.notes } : {}),
      };
    }
    update = { $set: set };
  }

  const updated = await orders.findOneAndUpdate(
    {
      _id: orderId,
      userId: user._id,
      status: fromStatus,
      cutoffAt: { $gt: now },
    },
    update,
    { returnDocument: "after" },
  );

  if (!updated) {
    const existing = await orders.findOne({ _id: orderId, userId: user._id });
    if (!existing) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json(
      {
        error:
          existing.cutoffAt.getTime() <= now.getTime()
            ? "This order is locked — the 6:00 AM cutoff has passed."
            : `This order can't be ${input.action === "unskip" ? "restored" : "changed"} in its current state.`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ order: orderToJson(updated) });
}
