import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { vendorsCollection } from "@/lib/collections";
import { geocodeAddress } from "@/lib/geocode";
import { newDocumentMeta } from "@/lib/models";
import type { Vendor } from "@/lib/models";

export const runtime = "nodejs";

const createVendorSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  address: z.string().trim().min(5).max(500),
  capacityPerHour: z.number().int().min(1).max(1000),
});

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createVendorSchema.safeParse(await request.json().catch(() => null));
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
  // Admin-created vendors skip review and go straight to `active`; the
  // self-serve path is the application flow at /vendor/apply.
  const vendor: Vendor = {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    businessName: parsed.data.businessName,
    status: "active",
    address: geocoded.formattedAddress,
    geo: geocoded.geo,
    capabilities: [],
    capacityPerHour: parsed.data.capacityPerHour,
    portalUserSubs: [],
    createdAt: now,
    updatedAt: now,
  };

  const vendors = await vendorsCollection();
  await vendors.insertOne(vendor);
  return NextResponse.json({ id: vendor._id.toHexString() }, { status: 201 });
}
