import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { preferencesCollection, vendorsCollection } from "@/lib/collections";
import { personalPreferenceFilter } from "@/lib/preferences";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const inputSchema = z.object({
  /** null clears the preferred vendor (platform always auto-routes). */
  vendorId: z
    .string()
    .regex(/^[0-9a-f]{24}$/i)
    .nullable(),
  method: z.enum(["manual", "ai"]).optional(),
});

/**
 * Confirm (or clear) the subscriber's preferred vendor. This is the
 * confirmation step from the hybrid selection flow — only here does a
 * manual pick or AI recommendation take effect (critical rule #5). Routing
 * then uses it whenever the vendor is available, falling back to
 * auto-routing otherwise.
 */
export async function PUT(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;
  if (input.vendorId !== null && !input.method) {
    return NextResponse.json(
      { error: "A selection method is required when choosing a vendor." },
      { status: 400 },
    );
  }

  const preferences = await preferencesCollection();
  const preference = await preferences.findOne(personalPreferenceFilter(user._id));
  if (!preference) {
    return NextResponse.json(
      { error: "Set your usual drink and schedule before choosing a vendor." },
      { status: 409 },
    );
  }

  const now = new Date();

  if (input.vendorId === null) {
    await preferences.updateOne(
      { _id: preference._id },
      {
        $unset: { preferredVendorId: "", vendorSelectionMethod: "" },
        $set: { updatedAt: now },
      },
    );
    return NextResponse.json({ preferredVendorId: null, method: null });
  }

  // The chosen vendor must be a real, active vendor.
  const vendors = await vendorsCollection();
  const vendor = await vendors.findOne({ _id: new ObjectId(input.vendorId), status: "active" });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found or unavailable." }, { status: 404 });
  }

  await preferences.updateOne(
    { _id: preference._id },
    {
      $set: {
        preferredVendorId: vendor._id,
        vendorSelectionMethod: input.method,
        updatedAt: now,
      },
    },
  );
  return NextResponse.json({
    preferredVendorId: vendor._id.toHexString(),
    method: input.method,
  });
}
