import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { vendorsCollection } from "@/lib/collections";
import { geocodeAddress } from "@/lib/geocode";
import type { Vendor } from "@/lib/models";
import { newDocumentMeta, operatingHoursSchema, suggestMarketFromGeo } from "@/lib/models";
import { getOrCreateCurrentUser } from "@/lib/users";
import { findVendorForUser } from "@/lib/vendors";

export const runtime = "nodejs";

const applySchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  address: z.string().trim().min(5).max(500),
  capacityPerHour: z.number().int().min(1).max(1000),
  serviceAreaRadiusKm: z.number().min(1).max(100),
  // Applicants must declare at least one open day; v1-migrated vendors are
  // the only ones allowed to have no hours (treated as always open).
  operatingHours: operatingHoursSchema.refine((hours) => hours.length > 0, {
    message: "at least one open day",
  }),
});

/**
 * Vendor application: any logged-in user can apply once. The application
 * is a Vendor in status `pending` until an admin reviews it; a rejected
 * applicant can re-apply, which reopens the same document as `pending`.
 */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = applySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const existing = await findVendorForUser(user);
  if (existing && existing.status !== "rejected") {
    return NextResponse.json(
      { error: "This account is already linked to a vendor or has an application in review." },
      { status: 409 },
    );
  }

  const geocoded = await geocodeAddress(input.address);
  if (!geocoded) {
    // §12.1: a clear, recoverable error — the applicant fixes the address and
    // re-submits (a vendor needs a geocoded location for routing/service area).
    return NextResponse.json(
      {
        error:
          "We couldn't locate that address on the map. Please check it (include city + postcode) and try again.",
      },
      { status: 422 },
    );
  }

  const now = new Date();
  const application = {
    businessName: input.businessName,
    address: geocoded.formattedAddress,
    geo: geocoded.geo,
    // Phase M: geocoded market suggestion; the admin confirms/overrides it at
    // approval (it is authoritative only once an admin sets it there).
    market: suggestMarketFromGeo(geocoded.geo),
    operatingHours: input.operatingHours,
    serviceAreaRadiusKm: input.serviceAreaRadiusKm,
    capacityPerHour: input.capacityPerHour,
    appliedAt: now,
  };

  if (existing) {
    // Re-application after rejection reopens the same vendor document.
    await (
      await vendorsCollection()
    ).updateOne(
      { _id: existing._id, status: "rejected" },
      {
        $set: { ...application, status: "pending" as const, updatedAt: now },
        $unset: { reviewedAt: "", reviewNote: "" },
      },
    );
    return NextResponse.json({ id: existing._id.toHexString() });
  }

  const vendor: Vendor = {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    ...application,
    ownerUserId: user._id,
    status: "pending",
    capabilities: [],
    // The owner gets portal access the moment the application is approved.
    portalUserSubs: [user.authSub],
    createdAt: now,
    updatedAt: now,
  };
  await (await vendorsCollection()).insertOne(vendor);
  return NextResponse.json({ id: vendor._id.toHexString() }, { status: 201 });
}
