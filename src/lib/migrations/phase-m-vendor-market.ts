import { vendorsCollection } from "@/lib/collections";

/**
 * Phase M migration — give every existing vendor a `market`. BrewPass launched
 * in Malaysia, so all pre-Phase-M vendors (Vendor #1 and any onboarded since)
 * are `MY`; AU vendors only exist from Phase M onward, set authoritatively by
 * the admin at approval. Mirrors the Phase A/I/J discipline: both directions
 * exist and both are idempotent and reversible (critical rule #10). No index
 * change — `market` is a plain scoping field, not part of any unique key.
 *
 * - `up`: stamp `market: "MY"` on every vendor missing it. Re-runs are no-ops.
 * - `down`: unset `market` on every vendor that has it. Only meaningful while
 *   no AU vendor depends on the field (Phase M is additive; before any AU
 *   onboarding this is a clean rollback).
 */

const DEFAULT_MARKET = "MY";

/** Pure (unit-tested) per-document decision: stamp `MY` only when `market` is
 * missing/invalid, so a re-run never reclassifies an admin-set AU vendor. */
export function marketBackfillPatch(doc: { market?: unknown }): { market?: string } {
  if (doc.market === "MY" || doc.market === "AU") return {};
  return { market: DEFAULT_MARKET };
}

export interface PhaseMMigrationSummary {
  direction: "up" | "down";
  /** up: vendors stamped MY. down: vendors whose market was removed. */
  marketSet: number;
}

export async function migratePhaseMUp(): Promise<PhaseMMigrationSummary> {
  const vendors = await vendorsCollection();
  const result = await vendors.updateMany(
    { market: { $exists: false } },
    { $set: { market: DEFAULT_MARKET } },
  );
  return { direction: "up", marketSet: result.modifiedCount };
}

export async function migratePhaseMDown(): Promise<PhaseMMigrationSummary> {
  const vendors = await vendorsCollection();
  const result = await vendors.updateMany(
    { market: { $exists: true } },
    { $unset: { market: "" } },
  );
  return { direction: "down", marketSet: result.modifiedCount };
}
