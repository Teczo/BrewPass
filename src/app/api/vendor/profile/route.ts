import { NextResponse } from "next/server";
import { z } from "zod";

import { vendorsCollection } from "@/lib/collections";
import { geocodeAddress } from "@/lib/geocode";
import { localTimeSchema, operatingHoursSchema, slotCapacitySchema } from "@/lib/models";
import {
  reassignChargedOrdersForOfflineVendor,
  vendorWentOffline,
} from "@/lib/order-engine/reassign";
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
    /** Phase E: how often delivered funds are swept to the vendor (their
     * choice; never gates whether payout happens). */
    payoutCadence: z.enum(["per_order", "daily_batch"]).optional(),
    /** Phase F capacity controls. null clears the value. */
    dailyCapacity: z.number().int().positive().nullable().optional(),
    slotCapacities: slotCapacitySchema.optional(),
    orderAcceptCutoff: localTimeSchema.nullable().optional(),
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
  const unset: Record<string, ""> = {};
  if (input.businessName !== undefined) updates.businessName = input.businessName;
  if (input.operatingHours !== undefined) updates.operatingHours = input.operatingHours;
  if (input.serviceAreaRadiusKm !== undefined)
    updates.serviceAreaRadiusKm = input.serviceAreaRadiusKm;
  if (input.status !== undefined) updates.status = input.status;
  if (input.payoutCadence !== undefined) updates.payoutCadence = input.payoutCadence;
  if (input.slotCapacities !== undefined) updates.slotCapacities = input.slotCapacities;
  // null clears a capacity control; a value sets it.
  if (input.dailyCapacity === null) unset.dailyCapacity = "";
  else if (input.dailyCapacity !== undefined) updates.dailyCapacity = input.dailyCapacity;
  if (input.orderAcceptCutoff === null) unset.orderAcceptCutoff = "";
  else if (input.orderAcceptCutoff !== undefined)
    updates.orderAcceptCutoff = input.orderAcceptCutoff;

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
    {
      $set: { ...updates, updatedAt: new Date() },
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    },
    { returnDocument: "after" },
  );
  if (!updated) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });

  // Phase O.2 §2.5: if the vendor just went offline, rescue its already-charged,
  // not-yet-delivered orders (reassign at the snapshot price, else auto-refund).
  // Best-effort — never blocks the status change.
  if (input.status && vendorWentOffline(context.vendor.status, input.status)) {
    try {
      const result = await reassignChargedOrdersForOfflineVendor(context.vendor._id);
      console.log("vendor-offline reassignment:", JSON.stringify(result));
    } catch (error) {
      console.error("§2.5 reassignment on vendor pause/offline failed:", error);
    }
  }

  return NextResponse.json({ vendor: vendorToJson(updated) });
}
