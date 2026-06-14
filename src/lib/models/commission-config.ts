import { z } from "zod";

import { baseDocumentSchema } from "@/lib/models/shared";

/** Basis points: 1% = 100 bps, 100% = 10000 bps. Money stays integer. */
export const commissionBpsSchema = z.number().int().min(0).max(10_000);

/**
 * Platform-wide commission settings (Phase E). A single document holds the
 * default rate; per-vendor overrides live on Vendor.commissionRateOverrideBps.
 * Admin-editable in Phase H. When absent, code falls back to
 * PLATFORM_DEFAULT_COMMISSION_BPS.
 */
export const commissionConfigSchema = baseDocumentSchema.extend({
  /** Marks the singleton row so the loader can upsert on it. */
  key: z.literal("platform"),
  defaultRateBps: commissionBpsSchema,
});
export type CommissionConfig = z.infer<typeof commissionConfigSchema>;
