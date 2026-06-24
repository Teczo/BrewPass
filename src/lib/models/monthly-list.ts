import { z } from "zod";

import {
  baseDocumentSchema,
  drinkSpecSchema,
  localDateSchema,
  localTimeSchema,
  moneySenSchema,
  objectIdSchema,
  weekdaySchema,
} from "@/lib/models/shared";
import { orderLocationSnapshotSchema } from "@/lib/models/order";

/** Calendar month the list plans for, formatted YYYY-MM (KL local). */
export const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM");

/**
 * One planned delivery day inside a monthly list. Each entry snapshots the
 * drink (taxonomy-based, critical rule #5), the assigned vendor, and the
 * vendor's price for that drink, so confirmation never has to re-read live
 * preferences or menus (critical rule #6).
 *
 * `vendorId === null` means the planner found no eligible vendor for that
 * day; on confirm such days are left to the nightly routing job to fill
 * closer to the date (availability may differ by then). `skipped` is the
 * user's explicit "no coffee that day" choice and suppresses generation.
 */
export const monthlyListEntrySchema = z.object({
  date: localDateSchema,
  weekday: weekdaySchema,
  drink: drinkSpecSchema,
  vendorId: objectIdSchema.nullable(),
  /** How the vendor was chosen (mirrors Order.assignmentMethod). Null when
   * no vendor is assigned. */
  assignmentMethod: z.enum(["user_preferred", "ai_routed"]).nullable(),
  /** Vendor's price for the drink in sen, snapshotted at plan time. */
  priceSen: moneySenSchema.optional(),
  /** AI's one-line "why this coffee + vendor" for the day. Set only on the
   * AI-varied plan; absent on the deterministic/usual plan. Advisory copy —
   * never read by the order pipeline. */
  rationale: z.string().max(300).optional(),
  /** User opted out of this day — no order is generated for it. */
  skipped: z.boolean(),
});
export type MonthlyListEntry = z.infer<typeof monthlyListEntrySchema>;

/**
 * The Phase D.5 "choose once a month" artifact. The AI (or a manual flow)
 * proposes a full month of vendor-assigned daily drinks; the user reviews,
 * edits, and confirms. On confirm the list becomes the source of truth from
 * which individual scheduled daily Orders are created (critical rule #7 —
 * effective only after confirm). One list per (userId, period).
 */
export const monthlyListSchema = baseDocumentSchema.extend({
  userId: objectIdSchema,
  subscriptionId: objectIdSchema,
  period: periodSchema,
  status: z.enum(["proposed", "confirmed"]),
  generationMethod: z.enum(["ai", "manual"]),
  /** Delivery time (HH:mm KL), snapshotted from the schedule at plan time. */
  time: localTimeSchema,
  /** Delivery location snapshot — shared by every order the list spawns. */
  location: orderLocationSnapshotSchema,
  entries: z.array(monthlyListEntrySchema),
  /** Set when the user confirms; orders are created at this moment. */
  confirmedAt: z.date().optional(),
});
export type MonthlyList = z.infer<typeof monthlyListSchema>;
