import { NextResponse } from "next/server";

import { vendorsCollection } from "@/lib/collections";
import { authenticateV1 } from "@/lib/v1/http";
import { v1Vendor } from "@/lib/v1/serializers";

export const runtime = "nodejs";

/**
 * Browsable vendors (Phase I.4): active vendors only, sorted by name. Caps
 * the result so the endpoint stays cheap; richer area/menu-aware discovery
 * stays on the internal `/api/vendors/available` route the picker uses.
 */
export async function GET() {
  const auth = await authenticateV1();
  if ("response" in auth) return auth.response;

  const vendors = await vendorsCollection();
  const docs = await vendors
    .find({ status: "active" })
    .sort({ businessName: 1 })
    .limit(100)
    .toArray();

  return NextResponse.json({ vendors: docs.map(v1Vendor) });
}
