import { preferencesCollection } from "@/lib/collections";
import { PERSONAL_SCOPE } from "@/lib/preferences";

/**
 * Phase J.2 migration — give every preference a `scope` and move the unique
 * index from `{ userId }` to `{ userId, scope }`, so a user can hold a
 * personal preference alongside per-membership office preferences. Mirrors the
 * Phase A/I discipline: both directions exist and both are idempotent
 * (critical rule #10).
 *
 * - `up`: stamp `scope: "personal"` on every preference missing it, then drop
 *   the old `{ userId }` unique index and create `{ userId, scope }` unique.
 *   The backfill runs BEFORE the new index so legacy rows (which would index
 *   as a null scope) don't collide.
 * - `down`: drop the `{ userId, scope }` index, recreate `{ userId }` unique,
 *   and unset `scope`. Only valid when no office preferences exist (they only
 *   appear once J.2 features are in use) — otherwise the unique `{ userId }`
 *   index legitimately can't be rebuilt.
 */

const OLD_INDEX = "userId_1";
const NEW_INDEX = "userId_1_scope_1";

/**
 * Pure (unit-tested) decision for one document: the `$set` patch to bring it
 * up to the J.2 scope. Only stamps `scope` when missing, so re-running never
 * clobbers an existing scope (personal or office). Empty when already scoped.
 */
export function scopeBackfillPatch(doc: { scope?: unknown }): { scope?: string } {
  if (typeof doc.scope === "string") return {};
  return { scope: PERSONAL_SCOPE };
}

export interface PhaseJ2MigrationSummary {
  direction: "up" | "down";
  /** up: preferences stamped personal. down: preferences whose scope was removed. */
  scopeSet: number;
  indexDropped: string | null;
  indexCreated: string | null;
}

/** Drop an index by name, tolerating "index not found" so the migration is
 * idempotent. */
async function dropIndexIfExists(
  coll: Awaited<ReturnType<typeof preferencesCollection>>,
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

export async function migratePhaseJ2Up(): Promise<PhaseJ2MigrationSummary> {
  const preferences = await preferencesCollection();

  const result = await preferences.updateMany(
    { scope: { $exists: false } },
    { $set: { scope: PERSONAL_SCOPE } },
  );

  const indexDropped = await dropIndexIfExists(preferences, OLD_INDEX);
  // createIndex is idempotent for an identical spec, so re-runs are safe.
  await preferences.createIndex({ userId: 1, scope: 1 }, { unique: true });

  return {
    direction: "up",
    scopeSet: result.modifiedCount,
    indexDropped,
    indexCreated: NEW_INDEX,
  };
}

export async function migratePhaseJ2Down(): Promise<PhaseJ2MigrationSummary> {
  const preferences = await preferencesCollection();

  const indexDropped = await dropIndexIfExists(preferences, NEW_INDEX);
  await preferences.createIndex({ userId: 1 }, { unique: true });

  const result = await preferences.updateMany(
    { scope: { $exists: true } },
    { $unset: { scope: "" } },
  );

  return {
    direction: "down",
    scopeSet: result.modifiedCount,
    indexDropped,
    indexCreated: OLD_INDEX,
  };
}
