import { NextResponse } from "next/server";
import { z } from "zod";

import {
  extractMenuFromImages,
  mappableOptionsFrom,
  MenuExtractionUnavailableError,
  SUPPORTED_IMAGE_TYPES,
} from "@/lib/menu-extraction";
import { loadActiveTaxonomy } from "@/lib/taxonomy";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";
// Image extraction is slow; give the model room beyond the default.
export const maxDuration = 60;

// ~7M base64 chars ≈ 5MB binary per image; cap count to bound the request.
const MAX_BASE64_LENGTH = 7_000_000;

const extractSchema = z.object({
  images: z
    .array(
      z.object({
        mediaType: z.enum(SUPPORTED_IMAGE_TYPES),
        dataBase64: z.string().min(1).max(MAX_BASE64_LENGTH),
      }),
    )
    .min(1)
    .max(5),
});

/**
 * Phase C.5 step 1 — upload + extract, NO writes. Sends the screenshots to
 * the model and returns proposal rows. The images are processed transiently
 * and never persisted (critical rules #12, #14). Persisting the reviewed rows
 * is a separate call (`PUT /api/vendor/menu/draft`).
 */
export async function POST(request: Request) {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = extractSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const options = mappableOptionsFrom(await loadActiveTaxonomy());
  if (options.length === 0) {
    return NextResponse.json(
      { error: "The platform menu isn't set up yet. Try again later or map your menu manually." },
      { status: 422 },
    );
  }

  try {
    const rows = await extractMenuFromImages(parsed.data.images, options);
    return NextResponse.json({ rows });
  } catch (error) {
    if (error instanceof MenuExtractionUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Menu extraction failed:", error);
    return NextResponse.json(
      { error: "Couldn't read that menu. Try a clearer image or map your menu manually." },
      { status: 502 },
    );
  }
}
