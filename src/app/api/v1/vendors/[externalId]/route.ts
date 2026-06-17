import { NextResponse } from "next/server";

import { vendorsCollection } from "@/lib/collections";
import { externalIdSchema } from "@/lib/models/shared";
import { authenticateV1, v1Error } from "@/lib/v1/http";
import { v1Vendor } from "@/lib/v1/serializers";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ externalId: string }> };

/** A single active vendor by its stable `externalId`. */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await authenticateV1();
  if ("response" in auth) return auth.response;

  const { externalId } = await context.params;
  if (!externalIdSchema.safeParse(externalId).success) {
    return v1Error(400, "invalid_request", "Invalid vendor id.");
  }

  const vendors = await vendorsCollection();
  const vendor = await vendors.findOne({ externalId, status: "active" });
  if (!vendor) return v1Error(404, "not_found", "Vendor not found.");

  return NextResponse.json({ vendor: v1Vendor(vendor) });
}
