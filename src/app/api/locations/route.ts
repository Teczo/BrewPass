import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { locationsCollection } from "@/lib/collections";
import { geocodeAddress } from "@/lib/geocode";
import { newDocumentMeta } from "@/lib/models";
import type { Location } from "@/lib/models";
import { locationToJson } from "@/lib/serializers";
import { getOrCreateCurrentUser } from "@/lib/users";
import { locationInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const locations = await locationsCollection();
  const docs = await locations.find({ userId: user._id }).sort({ createdAt: 1 }).toArray();
  return NextResponse.json({ locations: docs.map(locationToJson) });
}

export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = locationInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const geocoded = await geocodeAddress(parsed.data.address);
  if (!geocoded) {
    // §12.2: a geocode miss is a clear, recoverable error, not a crash — point
    // the user at the GPS fallback rather than blocking onboarding.
    return NextResponse.json(
      {
        error:
          'We couldn\'t verify that address. Check it for typos, or tap "Use my current location" to set it from your GPS.',
      },
      { status: 422 },
    );
  }

  const now = new Date();
  const doc: Location = {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    userId: user._id,
    label: parsed.data.label,
    address: geocoded.formattedAddress,
    geo: geocoded.geo,
    ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    createdAt: now,
    updatedAt: now,
  };

  const locations = await locationsCollection();
  await locations.insertOne(doc);
  return NextResponse.json({ location: locationToJson(doc) }, { status: 201 });
}
