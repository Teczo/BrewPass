import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { locationsCollection, preferencesCollection } from "@/lib/collections";
import { geocodeAddress } from "@/lib/geocode";
import { locationToJson } from "@/lib/serializers";
import { getOrCreateCurrentUser } from "@/lib/users";
import { locationInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const locationId = parseId(id);
  if (!locationId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const parsed = locationInputSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
  if (parsed.data.address !== undefined) {
    const geocoded = await geocodeAddress(parsed.data.address);
    if (!geocoded) {
      return NextResponse.json(
        { error: "Address could not be found. Try a more specific address." },
        { status: 422 },
      );
    }
    updates.address = geocoded.formattedAddress;
    updates.geo = geocoded.geo;
  }

  const locations = await locationsCollection();
  const updated = await locations.findOneAndUpdate(
    // Scope by userId so users can only touch their own locations.
    { _id: locationId, userId: user._id },
    { $set: updates },
    { returnDocument: "after" },
  );
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ location: locationToJson(updated) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const locationId = parseId(id);
  if (!locationId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const preferences = await preferencesCollection();
  const usedAsDefault = await preferences.findOne({
    userId: user._id,
    defaultLocationId: locationId,
  });
  if (usedAsDefault) {
    return NextResponse.json(
      { error: "This location is your default delivery location. Pick another default first." },
      { status: 409 },
    );
  }

  const locations = await locationsCollection();
  const result = await locations.deleteOne({ _id: locationId, userId: user._id });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
