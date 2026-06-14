import Anthropic from "@anthropic-ai/sdk";

import { formatMyr } from "@/lib/format";
import type { VendorCard } from "@/lib/vendor-selection";

/**
 * AI vendor recommender for the hybrid selection flow. The subscriber answers
 * a short priorities questionnaire and the platform recommends a vendor.
 * Server-only (critical rule #2). The recommendation is advisory: it takes
 * effect only after the user reviews and confirms it (critical rule #5).
 *
 * Primary path is a live Claude call; if the API key is absent or the call
 * fails, a deterministic priority scorer takes over so selection never
 * blocks on the model.
 */

export const PRIORITY_KEYS = ["proximity", "price", "speed", "rating", "drink"] as const;
export type PriorityKey = (typeof PRIORITY_KEYS)[number];
/** 0 = doesn't matter … 3 = top priority. */
export type Priorities = Record<PriorityKey, number>;

export interface Recommendation {
  vendorId: string;
  rationale: string;
  source: "ai" | "fallback";
}

const MODEL = "claude-opus-4-8";

function rationaleFor(card: VendorCard): string {
  const parts = [`${card.distanceKm} km away`];
  if (card.ratingScore !== null) parts.push(`rated ${card.ratingScore}★`);
  if (card.priceSen !== null) parts.push(`your drink at ${formatMyr(card.priceSen)}`);
  return `${card.name} — ${parts.join(", ")}.`;
}

/**
 * Deterministic priority-weighted pick (pure, unit-tested). Proximity and
 * speed both reward nearer vendors; rating and drink-quality both reward
 * higher ratings; price rewards cheaper. Used as the fallback and as the
 * reference behaviour in tests.
 */
export function deterministicRecommend(
  cards: VendorCard[],
  priorities: Priorities,
): { vendorId: string; rationale: string } {
  const wDistance = priorities.proximity + priorities.speed;
  const wPrice = priorities.price;
  const wRating = priorities.rating + priorities.drink;

  const distances = cards.map((c) => c.distanceKm);
  const minD = Math.min(...distances);
  const maxD = Math.max(...distances);
  const pricedValues = cards.map((c) => c.priceSen).filter((p): p is number => p !== null);
  const minP = pricedValues.length > 0 ? Math.min(...pricedValues) : 0;
  const maxP = pricedValues.length > 0 ? Math.max(...pricedValues) : 0;

  const norm = (value: number, min: number, max: number) =>
    max === min ? 0.5 : (value - min) / (max - min);

  function score(card: VendorCard): number {
    const distScore = 1 - norm(card.distanceKm, minD, maxD); // nearer is better
    const priceScore = card.priceSen === null ? 0.5 : 1 - norm(card.priceSen, minP, maxP);
    const ratingScore = card.ratingScore === null ? 0.5 : card.ratingScore / 5;
    // No priorities set → fall back to pure proximity.
    if (wDistance + wPrice + wRating === 0) return distScore;
    return wDistance * distScore + wPrice * priceScore + wRating * ratingScore;
  }

  const best = [...cards].sort((a, b) => {
    const delta = score(b) - score(a);
    if (Math.abs(delta) > 1e-9) return delta;
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    return a.id.localeCompare(b.id);
  })[0];

  return { vendorId: best.id, rationale: rationaleFor(best) };
}

const RECOMMENDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendorId: { type: "string", description: "The id of the recommended vendor." },
    rationale: {
      type: "string",
      description: "One short sentence explaining why this vendor fits the priorities.",
    },
  },
  required: ["vendorId", "rationale"],
} as const;

async function recommendWithClaude(
  cards: VendorCard[],
  priorities: Priorities,
): Promise<Recommendation> {
  const client = new Anthropic();
  const candidateLines = cards
    .map(
      (c) =>
        `- id=${c.id} | ${c.name} | ${c.distanceKm} km | rating ${c.ratingScore ?? "n/a"} | ` +
        `price ${c.priceSen === null ? "n/a" : formatMyr(c.priceSen)} | ` +
        `makes their drink: ${c.coversDrink ? "yes" : "no"}`,
    )
    .join("\n");
  const priorityLines = PRIORITY_KEYS.map((key) => `${key}: ${priorities[key]}/3`).join(", ");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: {
      format: { type: "json_schema", schema: RECOMMENDATION_SCHEMA },
      effort: "low",
    },
    system:
      "You help a coffee subscriber pick the best vendor for their daily delivery. " +
      "Weigh the candidate vendors against the subscriber's stated priorities " +
      "(each scored 0-3, higher means more important) and pick exactly one. " +
      "Prefer vendors that can make their drink. Return the vendor's id verbatim.",
    messages: [
      {
        role: "user",
        content: `Priorities: ${priorityLines}\n\nCandidate vendors:\n${candidateLines}`,
      },
    ],
  });

  const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  const parsed = JSON.parse(text) as { vendorId?: unknown; rationale?: unknown };
  const vendorId = typeof parsed.vendorId === "string" ? parsed.vendorId : "";
  const card = cards.find((c) => c.id === vendorId);
  if (!card) {
    throw new Error(`Claude returned an unknown vendor id: ${vendorId}`);
  }
  const rationale =
    typeof parsed.rationale === "string" && parsed.rationale.trim().length > 0
      ? parsed.rationale.trim()
      : rationaleFor(card);
  return { vendorId: card.id, rationale, source: "ai" };
}

/** Recommend a vendor from the candidate cards, or null when none fit. */
export async function recommendVendor(
  cards: VendorCard[],
  priorities: Priorities,
): Promise<Recommendation | null> {
  const covering = cards.filter((c) => c.coversDrink);
  const pool = covering.length > 0 ? covering : cards;
  if (pool.length === 0) return null;

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await recommendWithClaude(pool, priorities);
    } catch (error) {
      console.error("Claude vendor recommendation failed; using fallback scorer:", error);
    }
  }
  return { ...deterministicRecommend(pool, priorities), source: "fallback" };
}
