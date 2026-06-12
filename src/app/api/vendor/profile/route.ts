import { NextResponse } from "next/server";
import { z } from "zod";

import { vendorsCollection } from "@/lib/collections";
import { geocodeAddress } from "@/lib/geocode";
import { operatingHoursSchema } from "@/lib/models";
import { vendorToJson } from "@/lib/serializers";
import { canVendorSetStatus } from "@/lib/vendor-rules";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";

const updateProfileSchema = z
  .object({
    businessName: z.string().trim().min(1).max(120).optional(),
    /** Re-geocoded server-side; the stored address is always the geocoder's. */
    address: z.string().trim().min(5).max(500).optional(),
    operatingHours: operatingHoursSchema
      .refine((hours) => hours.length > 0, { message: "at least one open day" })
      .optional(),
    serviceAreaRadiusKm: z.number().min(1).max(100).optional(),
    /** Self-service status: operational states only — suspension and the
     * application states are owned by admin review (vendor-rules.ts). */
    status: z.enum(["active", "paused", "offline"]).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "nothing to update",
  });

export async function PATCH(request: Request) {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = updateProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  if (input.status && !canVendorSetStatus(context.vendor.status, input.status)) {
    return NextResponse.json({ error: "Status change not allowed." }, { status: 409 });
  }

  const updates: Record<string, unknown> = {};
  if (input.businessName !== undefined) updates.businessName = input.businessName;
  if (input.operatingHours !== undefined) updates.operatingHours = input.operatingHours;
  if (input.serviceAreaRadiusKm !== undefined)
    updates.serviceAreaRadiusKm = input.serviceAreaRadiusKm;
  if (input.status !== undefined) updates.status = input.status;

  if (input.address !== undefined) {
    const geocoded = await geocodeAddress(input.address);
    if (!geocoded) {
      return NextResponse.json(
        { error: "Address could not be found. Try a more specific address." },
        { status: 422 },
      );
    }
    updates.address = geocoded.formattedAddress;
    updates.geo = geocoded.geo;
  }

  const vendors = await vendorsCollection();
  const updated = await vendors.findOneAndUpdate(
    { _id: context.vendor._id },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });

  return NextResponse.json({ vendor: vendorToJson(updated) });
}
