import Anthropic from "@anthropic-ai/sdk";
import { ObjectId } from "mongodb";

import { formatMyr } from "@/lib/format";
import { vendorDrinkPriceSen } from "@/lib/menu";
import type { DrinkSpec, MonthlyListEntry } from "@/lib/models";
import { enumerateDeliveryDates } from "@/lib/monthly-list/planner";
import { distanceKm } from "@/lib/order-engine/logic";
import type { RoutingCandidate } from "@/lib/order-engine/routing";
import { selectVendor } from "@/lib/order-engine/routing";
import { isoWeekdayOf } from "@/lib/time";
import type { Priorities } from "@/lib/vendor-recommender";
import { PRIORITY_KEYS } from "@/lib/vendor-recommender";

/**
 * AI weekly/monthly planner (Phase A unified flow). From the priorities
 * questionnaire it proposes, for every delivery day, **both** a coffee (varied,
 * always a taxonomy drink — critical rule #5) and a vendor — with a one-line
 * rationale. Server-only (rule #2) and advisory: the plan is `proposed` and
 * only takes effect once the user reviews/edits/confirms it (rule #7).
 *
 * Structure mirrors the vendor recommender: a pure assembler (validates the
 * model's choices against the routing brain, unit-tested), a Claude wrapper,
 * and a deterministic fallback so planning never blocks on the model. Every
 * AI choice is re-validated through `selectVendor`, so an invalid or
 * unavailable suggestion silently falls back to normal routing for that day —
 * the model can never place an order with a vendor that can't make the drink.
 */

export interface AiPlanInput {
  period: string;
  /** Earliest delivery date to plan (inclusive). */
  fromDate: string;
  scheduleDays: number[];
  time: string;
  /** The user's usual drink — the anchor. The AI varies the `drink` name;
   * size/milk/sugar/strength are inherited so variety stays coherent. */
  anchorDrink: DrinkSpec;
  /** Canonical taxonomy drink names the AI may choose from. */
  allowedDrinks: string[];
  point: { lat: number; lng: number };
  /** Confirmed preferred vendor, used as the fallback when the AI doesn't pick
   * (or picks an ineligible vendor) for a day. */
  preferredVendorId: ObjectId | null;
  candidates: RoutingCandidate[];
  priorities: Priorities;
  nowLocalDate: string;
  nowLocalTime: string;
}

export interface DayChoice {
  date: string;
  drink: string;
  vendorId: string;
  rationale: string;
}

/**
 * Build the planned entries from the AI's per-day choices. Pure: every choice
 * is re-checked through `selectVendor`, which enforces service area, hours,
 * capacity and menu coverage for that day — so a bad/unavailable AI pick
 * gracefully falls back to normal routing. An empty `choices` map yields the
 * deterministic "usual every day" plan, which is exactly the no-AI fallback.
 */
export function assembleAiEntries(
  input: AiPlanInput,
  dates: string[],
  choices: Map<string, DayChoice>,
): MonthlyListEntry[] {
  const allowed = new Set(input.allowedDrinks);
  const candidateIds = new Set(input.candidates.map((c) => c.vendor._id.toHexString()));

  return dates.map((date) => {
    const choice = choices.get(date);

    // Only honour a drink the taxonomy actually offers (rule #5); else anchor.
    const drinkName = choice && allowed.has(choice.drink) ? choice.drink : input.anchorDrink.drink;
    const drink: DrinkSpec = { ...input.anchorDrink, drink: drinkName };

    // Honour the AI's vendor only if it's a real candidate; else fall back to
    // the user's confirmed preferred vendor (or pure auto-route when none).
    const aiVendorId =
      choice && ObjectId.isValid(choice.vendorId) && candidateIds.has(choice.vendorId)
        ? new ObjectId(choice.vendorId)
        : null;

    const result = selectVendor(
      {
        preferredVendorId: aiVendorId ?? input.preferredVendorId,
        point: input.point,
        date,
        weekday: isoWeekdayOf(date),
        time: input.time,
        drink: { drink: drinkName, milk: input.anchorDrink.milk },
        nowLocalDate: input.nowLocalDate,
        nowLocalTime: input.nowLocalTime,
      },
      input.candidates,
    );

    const entry: MonthlyListEntry = {
      date,
      weekday: isoWeekdayOf(date),
      drink,
      vendorId: result.ok ? result.vendorId : null,
      assignmentMethod: result.ok ? "ai_routed" : null,
      skipped: false,
    };

    if (result.ok) {
      const candidate = input.candidates.find((c) => c.vendor._id.equals(result.vendorId));
      const price = candidate ? vendorDrinkPriceSen(candidate.menuItems, drinkName) : null;
      if (price !== null) entry.priceSen = price;
      // Keep the AI's rationale only when its exact suggestion was honoured.
      const honoured = aiVendorId !== null && result.vendorId.equals(aiVendorId);
      if (honoured && choice && choice.rationale.trim().length > 0) {
        entry.rationale = choice.rationale.trim().slice(0, 300);
      }
    }
    return entry;
  });
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string", description: "Delivery date, YYYY-MM-DD, verbatim from input." },
          drink: { type: "string", description: "A coffee name verbatim from the allowed list." },
          vendorId: { type: "string", description: "The id of a candidate vendor, verbatim." },
          rationale: {
            type: "string",
            description: "One short sentence: why this coffee + vendor for the day.",
          },
        },
        required: ["date", "drink", "vendorId", "rationale"],
      },
    },
  },
  required: ["days"],
} as const;

const MODEL = "claude-opus-4-8";

function candidateLine(candidate: RoutingCandidate, point: { lat: number; lng: number }): string {
  const v = candidate.vendor;
  const km = Math.round(distanceKm(v.geo, point) * 10) / 10;
  const drinks = candidate.menuItems
    .filter((item) => item.category === "drink" && item.available)
    .map((item) => item.taxonomySlug);
  const makes = drinks.length === 0 ? "full menu" : drinks.join(", ");
  return (
    `- id=${v._id.toHexString()} | ${v.businessName} | ${km} km | ` +
    `rating ${v.ratingScore ?? "n/a"} | makes: ${makes}`
  );
}

async function planWeekWithClaude(input: AiPlanInput, dates: string[]): Promise<DayChoice[]> {
  const client = new Anthropic();
  const candidateLines = input.candidates.map((c) => candidateLine(c, input.point)).join("\n");
  const priorityLines = PRIORITY_KEYS.map((key) => `${key}: ${input.priorities[key]}/3`).join(", ");
  const anchorPrice = input.candidates
    .map((c) => vendorDrinkPriceSen(c.menuItems, input.anchorDrink.drink))
    .find((p): p is number => p !== null);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: {
      format: { type: "json_schema", schema: PLAN_SCHEMA },
      effort: "low",
    },
    system:
      "You plan a coffee subscriber's month of daily coffees. For EACH delivery date, " +
      "choose one coffee and one vendor to make it. Vary the coffee across the month so it " +
      "stays interesting, but keep every choice sensible for someone whose usual is given. " +
      "Rules: pick the coffee ONLY from the allowed drink list (verbatim); pick a vendor ONLY " +
      "from the candidate list that can make that coffee (a vendor 'makes: full menu' can make " +
      "anything); return vendor ids and dates verbatim. Weigh the candidates against the " +
      "subscriber's priorities (each 0-3, higher = more important). Give one short rationale per day.",
    messages: [
      {
        role: "user",
        content:
          `Usual coffee: ${input.anchorDrink.drink}` +
          (anchorPrice !== undefined ? ` (~${formatMyr(anchorPrice)})` : "") +
          `\nPriorities: ${priorityLines}` +
          `\nAllowed coffees: ${input.allowedDrinks.join(", ")}` +
          `\nDelivery dates: ${dates.join(", ")}` +
          `\n\nCandidate vendors:\n${candidateLines}`,
      },
    ],
  });

  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = JSON.parse(text) as { days?: unknown };
  if (!Array.isArray(parsed.days)) throw new Error("AI plan missing days array");
  return parsed.days.flatMap((raw): DayChoice[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const d = raw as Record<string, unknown>;
    if (
      typeof d.date !== "string" ||
      typeof d.drink !== "string" ||
      typeof d.vendorId !== "string"
    ) {
      return [];
    }
    return [
      {
        date: d.date,
        drink: d.drink,
        vendorId: d.vendorId,
        rationale: typeof d.rationale === "string" ? d.rationale : "",
      },
    ];
  });
}

/**
 * Plan every delivery day with the AI when possible, else deterministically.
 * Always returns valid entries — assembly re-validates each AI choice through
 * the routing brain, and a missing key / failed call simply produces the
 * deterministic "usual every day" plan.
 */
export async function aiPlanMonthlyEntries(input: AiPlanInput): Promise<MonthlyListEntry[]> {
  const dates = enumerateDeliveryDates(input.period, input.fromDate, input.scheduleDays);
  if (dates.length === 0) return [];

  let choices = new Map<string, DayChoice>();
  if (process.env.ANTHROPIC_API_KEY && input.candidates.length > 0) {
    try {
      const planned = await planWeekWithClaude(input, dates);
      choices = new Map(planned.map((choice) => [choice.date, choice]));
    } catch (error) {
      console.error("Claude monthly plan failed; using deterministic plan:", error);
    }
  }
  return assembleAiEntries(input, dates, choices);
}
