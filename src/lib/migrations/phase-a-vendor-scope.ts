import { Collection } from "mongodb";
import { z } from "zod";

import { vendorsCollection } from "@/lib/collections";
import { getDb } from "@/lib/db";
import type { Vendor } from "@/lib/models";
import { baseDocumentSchema, geoPointSchema, newDocumentMeta } from "@/lib/models/shared";

/**
 * Phase A migration: fold v1 `cafes` into `vendors` and scope orders to
 * `vendorId`. This is the point where v1 and v2 data diverge (critical
 * rule #8), so both directions exist and both are idempotent.
 *
 * - `up`: copy every café into `vendors` (same _id, so order references
 *   stay valid), then rename `cafeId` → `vendorId` on orders. The `cafes`
 *   collection is left untouched as a rollback backup. Safe to re-run:
 *   already-migrated vendors are skipped, the rename is a no-op on docs
 *   that already carry `vendorId`.
 * - `down`: write vendors back over `cafes` (any status other than
 *   `active` becomes `active: false`; v2-only fields are dropped), delete
 *   them from `vendors`, and rename `vendorId` → `cafeId` on orders. Only
 *   for rolling back to v1 code — the v2 app never reads `cafes`.
 */

/** v1 Cafe shape, kept here so the model could be deleted from the app. v1
 * records predate the Phase I reservations, so `externalId`/`tenantId` are
 * omitted here — `cafeToVendor` stamps them when folding a café into a vendor. */
export const legacyCafeSchema = baseDocumentSchema
  .omit({ externalId: true, tenantId: true })
  .extend({
    name: z.string(),
    address: z.string(),
    geo: geoPointSchema,
    capabilities: z.array(z.string()),
    capacityPerHour: z.number(),
    portalUserSubs: z.array(z.string()),
    active: z.boolean(),
  });
export type LegacyCafe = z.infer<typeof legacyCafeSchema>;

/** Pure mapping (unit-tested): same _id; active true/false → active/paused. */
export function cafeToVendor(cafe: LegacyCafe): Vendor {
  return {
    _id: cafe._id,
    // v1 cafés predate Phase I; stamp the reserved identity fields on fold.
    ...newDocumentMeta(),
    businessName: cafe.name,
    status: cafe.active ? "active" : "paused",
    // v1 cafés are the MY operation (Vendor #1 et al.) — Phase M market.
    market: "MY",
    address: cafe.address,
    geo: { ...cafe.geo },
    capabilities: [...cafe.capabilities],
    capacityPerHour: cafe.capacityPerHour,
    portalUserSubs: [...cafe.portalUserSubs],
    createdAt: cafe.createdAt,
    updatedAt: cafe.updatedAt,
  };
}

/** Inverse mapping for rollback. */
export function vendorToCafe(vendor: Vendor): LegacyCafe {
  return {
    _id: vendor._id,
    name: vendor.businessName,
    active: vendor.status === "active",
    address: vendor.address,
    geo: { ...vendor.geo },
    capabilities: [...vendor.capabilities],
    capacityPerHour: vendor.capacityPerHour,
    portalUserSubs: [...vendor.portalUserSubs],
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
  };
}

async function legacyCafesCollection(): Promise<Collection<LegacyCafe>> {
  return (await getDb()).collection<LegacyCafe>("cafes");
}

/** Untyped orders access: the $rename ops touch the retired `cafeId` key,
 * which the Order schema no longer knows about. */
async function rawOrdersCollection(): Promise<Collection> {
  return (await getDb()).collection("orders");
}

export interface PhaseAMigrationSummary {
  direction: "up" | "down";
  /** up: cafés copied into `vendors`. down: vendors written back to `cafes`. */
  vendorsWritten: number;
  /** up only: cafés that already had a vendor doc (re-run). */
  vendorsSkipped: number;
  /** Orders whose café/vendor reference field was renamed. */
  ordersRekeyed: number;
}

export async function migratePhaseAUp(): Promise<PhaseAMigrationSummary> {
  const [cafes, vendors, orders] = await Promise.all([
    legacyCafesCollection(),
    vendorsCollection(),
    rawOrdersCollection(),
  ]);
  const summary: PhaseAMigrationSummary = {
    direction: "up",
    vendorsWritten: 0,
    vendorsSkipped: 0,
    ordersRekeyed: 0,
  };

  for (const cafe of await cafes.find({}).toArray()) {
    // $setOnInsert: re-runs never clobber post-migration vendor edits.
    const result = await vendors.updateOne(
      { _id: cafe._id },
      { $setOnInsert: cafeToVendor(legacyCafeSchema.parse(cafe)) },
      { upsert: true },
    );
    if (result.upsertedCount === 1) summary.vendorsWritten += 1;
    else summary.vendorsSkipped += 1;
  }

  const renamed = await orders.updateMany(
    { cafeId: { $exists: true } },
    { $rename: { cafeId: "vendorId" } },
  );
  summary.ordersRekeyed = renamed.modifiedCount;
  return summary;
}

export async function migratePhaseADown(): Promise<PhaseAMigrationSummary> {
  const [cafes, vendors, orders] = await Promise.all([
    legacyCafesCollection(),
    vendorsCollection(),
    rawOrdersCollection(),
  ]);
  const summary: PhaseAMigrationSummary = {
    direction: "down",
    vendorsWritten: 0,
    vendorsSkipped: 0,
    ordersRekeyed: 0,
  };

  const vendorDocs = await vendors.find({}).toArray();
  for (const vendor of vendorDocs) {
    await cafes.replaceOne({ _id: vendor._id }, vendorToCafe(vendor), { upsert: true });
    summary.vendorsWritten += 1;
  }
  if (vendorDocs.length > 0) {
    await vendors.deleteMany({ _id: { $in: vendorDocs.map((vendor) => vendor._id) } });
  }

  const renamed = await orders.updateMany(
    { vendorId: { $exists: true } },
    { $rename: { vendorId: "cafeId" } },
  );
  summary.ordersRekeyed = renamed.modifiedCount;
  return summary;
}
