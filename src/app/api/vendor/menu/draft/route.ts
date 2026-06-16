import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { vendorMenuDraftsCollection } from "@/lib/collections";
import { menuDraftRowSchema } from "@/lib/models";
import { vendorMenuDraftToJson } from "@/lib/serializers";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";

/** Phase C.5 — the vendor's current onboarding draft, or null. */
export async function GET() {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const drafts = await vendorMenuDraftsCollection();
  const draft = await drafts.findOne({ vendorId: context.vendor._id });
  return NextResponse.json({ draft: draft ? vendorMenuDraftToJson(draft) : null });
}

const saveSchema = z.object({ rows: z.array(menuDraftRowSchema).max(200) });

/**
 * Phase C.5 step 2 — persist the reviewed rows as a draft (`status: proposed`)
 * so review is resumable. Persisting a draft is NOT publishing: nothing here
 * becomes a live VendorMenuItem and nothing is routable (critical rule #7).
 * One draft per vendor; re-saving replaces the rows and resets to `proposed`.
 */
export async function PUT(request: Request) {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const now = new Date();
  const drafts = await vendorMenuDraftsCollection();
  const updated = await drafts.findOneAndUpdate(
    { vendorId: context.vendor._id },
    {
      $set: { status: "proposed", rows: parsed.data.rows, updatedAt: now },
      $unset: { confirmedAt: "" },
      $setOnInsert: { _id: new ObjectId(), vendorId: context.vendor._id, createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!updated) return NextResponse.json({ error: "Failed to save draft" }, { status: 500 });

  return NextResponse.json({ draft: vendorMenuDraftToJson(updated) });
}
