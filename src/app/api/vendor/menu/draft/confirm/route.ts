import { NextResponse } from "next/server";

import { vendorMenuDraftsCollection } from "@/lib/collections";
import { proposalRowToMenuWrite } from "@/lib/menu-extraction";
import { writeVendorMenuItem } from "@/lib/menu-write";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";

interface RowResult {
  rawText: string;
  status: "published" | "skipped";
  slug?: string;
  reason?: string;
}

/**
 * Phase C.5 step 4 — confirm → publish. Each draft row is replayed through the
 * EXACT same gate a manual menu edit uses (`writeVendorMenuItem`); only rows
 * that pass become live VendorMenuItems (critical rule #13). Unmapped rows are
 * skipped and reported. The draft is then marked `confirmed`. Touches menu
 * data only — never routing/charging/payout (critical rule #14).
 */
export async function POST() {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const drafts = await vendorMenuDraftsCollection();
  const draft = await drafts.findOne({ vendorId: context.vendor._id });
  if (!draft || draft.rows.length === 0) {
    return NextResponse.json({ error: "No menu draft to confirm." }, { status: 422 });
  }

  const results: RowResult[] = [];
  let publishedCount = 0;
  for (const row of draft.rows) {
    const write = proposalRowToMenuWrite(row);
    if (!write) {
      results.push({ rawText: row.rawText, status: "skipped", reason: "Needs a menu mapping." });
      continue;
    }
    const result = await writeVendorMenuItem(context.vendor._id, write);
    if (result.ok) {
      publishedCount += 1;
      results.push({ rawText: row.rawText, status: "published", slug: write.slug });
    } else {
      results.push({
        rawText: row.rawText,
        status: "skipped",
        slug: write.slug,
        reason: result.error,
      });
    }
  }

  await drafts.updateOne(
    { _id: draft._id },
    { $set: { status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() } },
  );

  return NextResponse.json({
    publishedCount,
    skippedCount: results.length - publishedCount,
    results,
  });
}
