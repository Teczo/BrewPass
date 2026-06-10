import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { cafesCollection } from "@/lib/collections";
import { geocodeAddress } from "@/lib/geocode";
import type { Cafe } from "@/lib/models";

export const runtime = "nodejs";

const createCafeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(5).max(500),
  capacityPerHour: z.number().int().min(1).max(1000),
});

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createCafeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const geocoded = await geocodeAddress(parsed.data.address);
  if (!geocoded) {
    return NextResponse.json(
      { error: "Address could not be found. Try a more specific address." },
      { status: 422 },
    );
  }

  const now = new Date();
  const cafe: Cafe = {
    _id: new ObjectId(),
    name: parsed.data.name,
    address: geocoded.formattedAddress,
    geo: geocoded.geo,
    capabilities: [],
    capacityPerHour: parsed.data.capacityPerHour,
    portalUserSubs: [],
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  const cafes = await cafesCollection();
  await cafes.insertOne(cafe);
  return NextResponse.json({ id: cafe._id.toHexString() }, { status: 201 });
}
