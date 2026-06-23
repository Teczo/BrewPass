import type { ObjectId } from "mongodb";

import { ordersCollection, vendorPromotionsCollection } from "@/lib/collections";
import type { PromotionType } from "@/lib/models";
import { addDaysLocal, formatLocalTime12h, isoWeekdayOf, localDateOf, localTimeOf } from "@/lib/time";

/**
 * Phase K.3 — platform-suggested campaigns. The vendor dashboard analyzes the
 * vendor's OWN delivered-order history and proposes promotions ("Tuesday
 * mornings are your quietest — try a discount to fill them", or "offices buy
 * from you a lot — try a Vendor Pack").
 *
 * Suggestions are advisory ONLY (critical rule #21): they pre-fill the create
 * form, the vendor reviews and decides, and nothing here ever changes a price or
 * creates a promotion on its own. The logic is pure and unit-tested; an async
 * loader at the bottom wires it to the database.
 */

/** A single delivered coffee, flattened to what the analysis needs. */
export interface DeliveredOrderObservation {
  /** ISO weekday of delivery, 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Local delivery hour (0–23, Asia/Kuala_Lumpur). */
  hour: number;
  source: "personal" | "corporate";
}

/** An active promotion, reduced to what dedup needs. */
export interface ActivePromoSummary {
  type: PromotionType;
  applicableDays?: number[];
  windowStart?: string;
  windowEnd?: string;
}

/** A surfaced nudge. `prefill` matches the create-form fields so the vendor can
 * one-tap populate, review, and confirm. Fully JSON-serializable. */
export interface CampaignSuggestion {
  kind: "time_window_discount" | "pack";
  title: string;
  message: string;
  prefill:
    | {
        type: "time_window_discount";
        name: string;
        discountPct: number;
        windowStart: string;
        windowEnd: string;
        applicableDays: number[];
      }
    | {
        type: "pack";
        name: string;
        packSize: number;
        packMode: "buyer_choice";
      };
}

/** Analysis buckets the day into fixed two-hour blocks across daytime. */
export const SUGGESTION_BLOCK_HOURS = 2;
export const SUGGESTION_DAY_START_HOUR = 7;
export const SUGGESTION_DAY_END_HOUR = 19;

/** Don't suggest on thin history. */
export const MIN_ORDERS_FOR_TIME_WINDOW = 20;
export const MIN_ORDERS_FOR_PACK = 20;

/** A slot is "quiet" when it sits at or below this share of the average busy
 * slot's volume. */
export const QUIET_SHARE_OF_AVG = 0.6;
/** Offices are a meaningful share before a pack is worth suggesting. */
export const CORP_SHARE_FOR_PACK = 0.25;

/** A modest starter discount the vendor edits before confirming — a prefill,
 * not an enforced rate. */
export const SUGGESTED_DISCOUNT_PCT = 20;
/** A sensible starter pack size the vendor edits before confirming. */
export const SUGGESTED_PACK_SIZE = 10;

const WEEKDAY_NAMES = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** The daytime block index for a local hour, or null when outside daytime. */
export function blockIndexOf(hour: number): number | null {
  if (hour < SUGGESTION_DAY_START_HOUR || hour >= SUGGESTION_DAY_END_HOUR) return null;
  return Math.floor((hour - SUGGESTION_DAY_START_HOUR) / SUGGESTION_BLOCK_HOURS);
}

/** "HH:00" start of a block index. */
function blockStart(index: number): string {
  const hour = SUGGESTION_DAY_START_HOUR + index * SUGGESTION_BLOCK_HOURS;
  return `${hour.toString().padStart(2, "0")}:00`;
}

/** "HH:00" end (exclusive) of a block index. */
function blockEnd(index: number): string {
  const hour = SUGGESTION_DAY_START_HOUR + (index + 1) * SUGGESTION_BLOCK_HOURS;
  return `${hour.toString().padStart(2, "0")}:00`;
}

/** Whether two HH:mm windows overlap (half-open). */
function windowsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * The quietest (weekday, block) cell within the vendor's actual operating
 * pattern, or null. Only weekdays and blocks the vendor *already* serves are
 * eligible, so we never suggest discounting a slot the vendor is closed. The
 * quietest eligible cell is returned when it sits at or below QUIET_SHARE_OF_AVG
 * of the eligible-cell average. Deterministic: ties resolve to the earliest
 * weekday then earliest block.
 */
function quietestSlot(observations: DeliveredOrderObservation[]): {
  weekday: number;
  blockIndex: number;
} | null {
  const cells = new Map<string, number>();
  const openWeekdays = new Set<number>();
  const openBlocks = new Set<number>();
  let total = 0;

  for (const obs of observations) {
    const block = blockIndexOf(obs.hour);
    if (block === null) continue;
    openWeekdays.add(obs.weekday);
    openBlocks.add(block);
    const key = `${obs.weekday}:${block}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
    total++;
  }

  const eligibleCount = openWeekdays.size * openBlocks.size;
  if (total < MIN_ORDERS_FOR_TIME_WINDOW || eligibleCount < 2) return null;

  const average = total / eligibleCount;
  let best: { weekday: number; blockIndex: number; count: number } | null = null;
  for (const weekday of [...openWeekdays].sort((a, b) => a - b)) {
    for (const blockIndex of [...openBlocks].sort((a, b) => a - b)) {
      const count = cells.get(`${weekday}:${blockIndex}`) ?? 0;
      if (best === null || count < best.count) best = { weekday, blockIndex, count };
    }
  }

  if (best === null || best.count > QUIET_SHARE_OF_AVG * average) return null;
  return { weekday: best.weekday, blockIndex: best.blockIndex };
}

/**
 * Propose 0–2 campaigns from a vendor's delivered-order history, skipping any
 * that duplicate an active promotion. Pure.
 */
export function suggestCampaigns(args: {
  observations: DeliveredOrderObservation[];
  activePromotions: ActivePromoSummary[];
}): CampaignSuggestion[] {
  const { observations, activePromotions } = args;
  const suggestions: CampaignSuggestion[] = [];

  // 1) Time-window discount for the quietest operating slot.
  const quiet = quietestSlot(observations);
  if (quiet) {
    const windowStart = blockStart(quiet.blockIndex);
    const windowEnd = blockEnd(quiet.blockIndex);
    const duplicated = activePromotions.some(
      (p) =>
        p.type === "time_window_discount" &&
        (p.applicableDays?.includes(quiet.weekday) ?? false) &&
        p.windowStart !== undefined &&
        p.windowEnd !== undefined &&
        windowsOverlap(p.windowStart, p.windowEnd, windowStart, windowEnd),
    );
    if (!duplicated) {
      const dayName = WEEKDAY_NAMES[quiet.weekday];
      const slotLabel = `${formatLocalTime12h(windowStart)}–${formatLocalTime12h(windowEnd)}`;
      suggestions.push({
        kind: "time_window_discount",
        title: `${dayName} ${slotLabel} is your quietest slot`,
        message: `You serve the fewest coffees on ${dayName}s around ${slotLabel}. A ${SUGGESTED_DISCOUNT_PCT}% time-window discount could fill it — review and adjust before you launch.`,
        prefill: {
          type: "time_window_discount",
          name: `${dayName} ${slotLabel} discount`,
          discountPct: SUGGESTED_DISCOUNT_PCT,
          windowStart,
          windowEnd,
          applicableDays: [quiet.weekday],
        },
      });
    }
  }

  // 2) Vendor Pack when offices are a meaningful share and none is running.
  const total = observations.length;
  const corporate = observations.filter((o) => o.source === "corporate").length;
  const hasActivePack = activePromotions.some((p) => p.type === "pack");
  if (total >= MIN_ORDERS_FOR_PACK && !hasActivePack && corporate / total >= CORP_SHARE_FOR_PACK) {
    const pct = Math.round((corporate / total) * 100);
    suggestions.push({
      kind: "pack",
      title: "Offices order from you often",
      message: `${pct}% of your deliveries go to offices. A discounted Vendor Pack could win more bulk orders — set the size and price, then launch.`,
      prefill: {
        type: "pack",
        name: "Office pack",
        packSize: SUGGESTED_PACK_SIZE,
        packMode: "buyer_choice",
      },
    });
  }

  return suggestions;
}

/** How far back the analysis looks. */
export const SUGGESTION_LOOKBACK_DAYS = 90;

/**
 * Load a vendor's recent delivered orders + active promotions and compute the
 * suggested campaigns. Best-effort, read-only — never mutates anything.
 */
export async function loadCampaignSuggestions(
  vendorId: ObjectId,
  now: Date = new Date(),
): Promise<CampaignSuggestion[]> {
  const since = addDaysLocal(localDateOf(now), -SUGGESTION_LOOKBACK_DAYS);
  const [orders, promos] = await Promise.all([ordersCollection(), vendorPromotionsCollection()]);

  const [delivered, activePromos] = await Promise.all([
    orders.find({ vendorId, status: "delivered", date: { $gte: since } }).toArray(),
    promos.find({ vendorId, status: "active" }).toArray(),
  ]);

  const observations: DeliveredOrderObservation[] = delivered.map((order) => ({
    weekday: isoWeekdayOf(localDateOf(order.deliverAt)),
    hour: Number(localTimeOf(order.deliverAt).slice(0, 2)),
    source: order.source,
  }));

  const activePromotions: ActivePromoSummary[] = activePromos.map((p) => ({
    type: p.type,
    applicableDays: p.applicableDays,
    windowStart: p.windowStart,
    windowEnd: p.windowEnd,
  }));

  return suggestCampaigns({ observations, activePromotions });
}
