import Anthropic from "@anthropic-ai/sdk";

import { menuWriteSchema, type MenuWriteInput } from "@/lib/menu-write";
import type { MenuDraftRow } from "@/lib/models";
import type { GroupedTaxonomy } from "@/lib/taxonomy";

/**
 * AI-assisted menu onboarding (Phase C.5). A vendor uploads a menu screenshot
 * (e.g. their Grab/Uber listing); this extracts the items and maps each onto
 * the platform taxonomy so onboarding becomes a quick review instead of a
 * manual mapping chore. Server-only.
 *
 * Hard boundaries (critical rules #12, #14): the screenshot is processed
 * transiently in-request and NEVER persisted; this module touches menu data
 * only — never routing, cutoff, charging, payout, or order generation. It
 * proposes; the vendor confirms; nothing here writes a live VendorMenuItem.
 */

export const MAPPABLE_CATEGORIES = ["drink", "milk", "addon"] as const;
export type MappableCategory = (typeof MAPPABLE_CATEGORIES)[number];

/** One mappable taxonomy option, as offered to the model and the review UI. */
export interface MenuTaxonomyOption {
  slug: string;
  label: string;
  category: MappableCategory;
}

/** Flatten the menu-managed taxonomy categories (drink/milk/add-on) into the
 * option list the model maps onto and the review UI offers in its selects.
 * Sizes and strength are universal and never vendor-mapped. */
export function mappableOptionsFrom(groups: GroupedTaxonomy): MenuTaxonomyOption[] {
  return MAPPABLE_CATEGORIES.flatMap((category) =>
    groups[category].map((option) => ({ slug: option.slug, label: option.label, category })),
  );
}

const MODEL = "claude-opus-4-8";

/** Image formats the model accepts (mirrors the Anthropic image source type). */
export const SUPPORTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

/** A menu screenshot supplied by the vendor, base64-encoded in-request. */
export interface MenuImageInput {
  mediaType: SupportedImageType;
  dataBase64: string;
}

/** Thrown when the model isn't configured/available, so the route can tell
 * the vendor to map their menu manually instead of failing opaquely. */
export class MenuExtractionUnavailableError extends Error {
  constructor() {
    super("AI menu extraction is unavailable. Map your menu manually instead.");
    this.name = "MenuExtractionUnavailableError";
  }
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      description: "One row per distinct drink/milk/add-on found on the menu.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          rawText: {
            type: "string",
            description: "The item exactly as printed on the menu, e.g. 'Iced Oat Latte'.",
          },
          matchedTaxonomyRef: {
            type: ["string", "null"],
            description:
              "The slug of the single best-matching platform option, copied verbatim " +
              "from the provided list, or null when no option clearly fits.",
          },
          proposedPriceSen: {
            type: ["integer", "null"],
            description:
              "Price in sen (1 MYR = 100 sen) read off the menu, or null if no price is shown.",
          },
          confidence: {
            type: "number",
            description: "0–1 confidence that matchedTaxonomyRef is correct.",
          },
        },
        required: ["rawText", "matchedTaxonomyRef", "proposedPriceSen", "confidence"],
      },
    },
  },
  required: ["items"],
} as const;

/** Clamp/repair the model's raw rows against the active taxonomy. A ref that
 * isn't a known mappable slug is dropped to null ("needs your input"); price
 * and confidence are coerced into range. Pure and unit-tested. */
export function normalizeProposalRows(raw: unknown, validSlugs: Set<string>): MenuDraftRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: MenuDraftRow[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    const rawText = typeof candidate.rawText === "string" ? candidate.rawText.trim() : "";
    if (rawText.length === 0) continue;

    const ref =
      typeof candidate.matchedTaxonomyRef === "string" &&
      validSlugs.has(candidate.matchedTaxonomyRef)
        ? candidate.matchedTaxonomyRef
        : null;

    const priceValue = candidate.proposedPriceSen;
    const proposedPriceSen =
      typeof priceValue === "number" && Number.isFinite(priceValue) && priceValue >= 0
        ? Math.min(Math.round(priceValue), 100_000)
        : null;

    const confValue = candidate.confidence;
    const confidence =
      typeof confValue === "number" && Number.isFinite(confValue)
        ? Math.min(Math.max(confValue, 0), 1)
        : 0;

    rows.push({
      rawText: rawText.slice(0, 300),
      matchedTaxonomyRef: ref,
      proposedPriceSen,
      confidence,
    });
  }
  return rows;
}

/**
 * Turn a reviewed draft row into the exact payload a manual menu edit sends,
 * or null when the row has no taxonomy mapping (it can't be published and is
 * reported back as skipped). Publishing a kept row means making it available;
 * the shared `writeVendorMenuItem` gate then enforces price-when-available.
 */
export function proposalRowToMenuWrite(row: MenuDraftRow): MenuWriteInput | null {
  if (!row.matchedTaxonomyRef) return null;
  const candidate = {
    slug: row.matchedTaxonomyRef,
    available: true,
    ...(row.proposedPriceSen !== null ? { priceSen: row.proposedPriceSen } : {}),
  };
  // Shape it through the same schema the manual editor uses; never fork it.
  const parsed = menuWriteSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Extract menu rows from one or more screenshots and map them onto the given
 * taxonomy options. Returns proposal rows only — performs no writes and does
 * not retain the images. Throws MenuExtractionUnavailableError when the model
 * isn't configured.
 */
export async function extractMenuFromImages(
  images: MenuImageInput[],
  options: MenuTaxonomyOption[],
): Promise<MenuDraftRow[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new MenuExtractionUnavailableError();

  const validSlugs = new Set(options.map((option) => option.slug));
  const optionLines = options
    .map((option) => `- ${option.slug} (${option.category}): ${option.label}`)
    .join("\n");

  const client = new Anthropic();
  const imageBlocks = images.map((image) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: image.mediaType, data: image.dataBase64 },
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: {
      format: { type: "json_schema", schema: EXTRACTION_SCHEMA },
      effort: "low",
    },
    system:
      "You read a coffee shop's menu from screenshots and map each item onto a " +
      "fixed platform taxonomy of drinks, milks, and add-ons. For every distinct " +
      "item you can read, emit one row: its raw text, the slug of the single best " +
      "matching platform option (copied verbatim, or null if nothing clearly fits), " +
      "the price in sen if shown, and your confidence. Never invent slugs or prices. " +
      "Prefer null over a weak guess; the vendor will fix unmapped rows.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `Platform options you may map onto:\n${optionLines}` },
          ...imageBlocks,
        ],
      },
    ],
  });

  const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const items = (parsed as { items?: unknown })?.items;
  return normalizeProposalRows(items, validSlugs);
}
