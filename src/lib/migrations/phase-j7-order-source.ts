import { ordersCollection } from "@/lib/collections";

/**
 * Phase J.7 migration — give every order a `source` and move the unique index
 * from `{ userId, date }` to `{ userId, date, source }`, so a member can hold a
 * personal order and an office order on the same day (critical rule #17).
 * Mirrors the Phase A/I/J.2 discipline: both directions exist and both are
 * idempotent (critical rule #10).
 *
 * - `up`: stamp `source: "personal"` on every order missing it (all pre-J.7
 *   orders are personal), then drop the old `{ userId, date }` unique index and
 *   create `{ userId, date, source }` unique. Backfill runs BEFORE the new
 *   index so legacy rows (which would index as a null source) don't collide.
 * - `down`: drop the new index, recreate `{ userId, date }` unique, and unset
 *   `source`. Only valid while no corporate (office) orders exist.
 */

const OLD_INDEX = "userId_1_date_1";
const NEW_INDEX = "userId_1_date_1_source_1";

/** Pure (unit-tested) per-document decision: stamp `personal` only when
 * `source` is missing, so re-runs never reclassify an office order. */
export function sourceBackfillPatch(doc: { source?: unknown }): { source?: string } {
  if (typeof doc.source === "string") return {};
  return { source: "personal" };
}

export interface PhaseJ7MigrationSummary {
  direction: "up" | "down";
  /** up: orders stamped personal. down: orders whose source was removed. */
  sourceSet: number;
  indexDropped: string | null;
  indexCreated: string | null;
}

async function dropIndexIfExists(
  coll: Awaited<ReturnType<typeof ordersCollection>>,
  name: string,
): Promise<string | null> {
  try {
    await coll.dropIndex(name);
    return name;
  } catch (err) {
    // 27 = IndexNotFound. Already dropped (re-run) — not an error.
    if (err && typeof err === "object" && (err as { code?: number }).code === 27) return null;
    throw err;
  }
}

export async function migratePhaseJ7Up(): Promise<PhaseJ7MigrationSummary> {
  const orders = await ordersCollection();

  const result = await orders.updateMany(
    { source: { $exists: false } },
    { $set: { source: "personal" } },
  );

  const indexDropped = await dropIndexIfExists(orders, OLD_INDEX);
  await orders.createIndex({ userId: 1, date: 1, source: 1 }, { unique: true });

  return { direction: "up", sourceSet: result.modifiedCount, indexDropped, indexCreated: NEW_INDEX };
}

export async function migratePhaseJ7Down(): Promise<PhaseJ7MigrationSummary> {
  const orders = await ordersCollection();

  const indexDropped = await dropIndexIfExists(orders, NEW_INDEX);
  await orders.createIndex({ userId: 1, date: 1 }, { unique: true });

  const result = await orders.updateMany(
    { source: { $exists: true } },
    { $unset: { source: "" } },
  );

  return { direction: "down", sourceSet: result.modifiedCount, indexDropped, indexCreated: OLD_INDEX };
}
