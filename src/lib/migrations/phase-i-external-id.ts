import { randomUUID } from "node:crypto";

import { Collection, ObjectId, type AnyBulkWriteOperation } from "mongodb";

import { getDb } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/models/shared";

/**
 * Phase I.2/I.3 migration: backfill the reserved identity fields —
 * `externalId` (a stable per-document UUID) and `tenantId` (a single
 * default constant) — onto every existing domain document. Mirrors the
 * Phase A/C discipline: both directions exist and both are idempotent
 * (critical rule #10).
 *
 * - `up`: for each domain collection, generate a unique `externalId` on
 *   every row missing one and set `tenantId` to the default where unset.
 *   Idempotent — rows already carrying both fields are untouched, so a
 *   freshly-created (already-stamped) document is never re-generated.
 * - `down`: `$unset` both fields across every domain collection. Purely
 *   for rolling back the reservation; the app stamps the fields on create,
 *   so a `down` followed by normal operation simply re-accumulates them.
 *
 * The internal `webhookEvents` idempotency ledger is intentionally excluded:
 * it is not a domain entity, never crosses the API boundary, and has its own
 * minimal schema.
 */

/** Domain collections that carry the Phase I reservations. */
export const PHASE_I_COLLECTIONS = [
  "users",
  "locations",
  "preferences",
  "subscriptions",
  "orders",
  "vendors",
  "monthlyLists",
  "vendorPayouts",
  "commissionConfig",
  "ratings",
  "optionTaxonomy",
  "vendorMenuItems",
  "vendorMenuDrafts",
  "deliveries",
  "corporateAccounts",
  "corporateMemberships",
  "preferenceSignals",
] as const;

export type PhaseICollectionName = (typeof PHASE_I_COLLECTIONS)[number];

interface ReservationFields {
  externalId?: unknown;
  tenantId?: unknown;
}

/**
 * Pure (unit-tested) decision for one document: the `$set` patch needed to
 * bring it up to the Phase I reservation. Only generates `externalId` when
 * it is missing, and only sets `tenantId` when it is missing — so re-running
 * never clobbers an existing id or a future per-tenant value. Returns an
 * empty object when the document already satisfies the reservation.
 */
export function backfillPatch(doc: ReservationFields): { externalId?: string; tenantId?: string } {
  const patch: { externalId?: string; tenantId?: string } = {};
  if (typeof doc.externalId !== "string") patch.externalId = randomUUID();
  if (typeof doc.tenantId !== "string") patch.tenantId = DEFAULT_TENANT_ID;
  return patch;
}

export interface PhaseICollectionSummary {
  externalIdSet: number;
  tenantIdSet: number;
}

export interface PhaseIMigrationSummary {
  direction: "up" | "down";
  perCollection: Record<string, PhaseICollectionSummary>;
  totalExternalIdSet: number;
  totalTenantIdSet: number;
  /** down only: documents that had at least one reserved field removed. */
  totalCleared: number;
}

const BULK_CHUNK = 500;

async function backfillCollection(
  coll: Collection,
  summary: PhaseICollectionSummary,
): Promise<void> {
  const cursor = coll.find<ReservationFields & { _id: ObjectId }>(
    { $or: [{ externalId: { $exists: false } }, { tenantId: { $exists: false } }] },
    { projection: { externalId: 1, tenantId: 1 } },
  );

  let ops: AnyBulkWriteOperation[] = [];
  const flush = async () => {
    if (ops.length === 0) return;
    await coll.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const doc of cursor) {
    const patch = backfillPatch(doc);
    if (Object.keys(patch).length === 0) continue;
    if (patch.externalId !== undefined) summary.externalIdSet += 1;
    if (patch.tenantId !== undefined) summary.tenantIdSet += 1;
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: patch } } });
    if (ops.length >= BULK_CHUNK) await flush();
  }
  await flush();
}

export async function migratePhaseIUp(): Promise<PhaseIMigrationSummary> {
  const db = await getDb();
  const summary: PhaseIMigrationSummary = {
    direction: "up",
    perCollection: {},
    totalExternalIdSet: 0,
    totalTenantIdSet: 0,
    totalCleared: 0,
  };

  for (const name of PHASE_I_COLLECTIONS) {
    const perCollection: PhaseICollectionSummary = { externalIdSet: 0, tenantIdSet: 0 };
    await backfillCollection(db.collection(name), perCollection);
    summary.perCollection[name] = perCollection;
    summary.totalExternalIdSet += perCollection.externalIdSet;
    summary.totalTenantIdSet += perCollection.tenantIdSet;
  }
  return summary;
}

export async function migratePhaseIDown(): Promise<PhaseIMigrationSummary> {
  const db = await getDb();
  const summary: PhaseIMigrationSummary = {
    direction: "down",
    perCollection: {},
    totalExternalIdSet: 0,
    totalTenantIdSet: 0,
    totalCleared: 0,
  };

  for (const name of PHASE_I_COLLECTIONS) {
    const result = await db
      .collection(name)
      .updateMany(
        { $or: [{ externalId: { $exists: true } }, { tenantId: { $exists: true } }] },
        { $unset: { externalId: "", tenantId: "" } },
      );
    summary.perCollection[name] = { externalIdSet: 0, tenantIdSet: 0 };
    summary.totalCleared += result.modifiedCount;
  }
  return summary;
}
