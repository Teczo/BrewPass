import { ObjectId } from "mongodb";

import { vendorsCollection } from "@/lib/collections";
import type { MonthlyList } from "@/lib/models";
import { v1MonthlyList } from "@/lib/v1/serializers";

/**
 * Resolve a set of internal vendor `_id`s to their stable `externalId`s,
 * keyed by `_id` hex. Used by `/v1` serializers to render vendor references
 * (on orders and monthly-list days) without leaking raw `_id`s across the
 * boundary (critical rule #14). Batches one query for the whole set.
 */
export async function vendorExternalIdsByHex(vendorIds: ObjectId[]): Promise<Map<string, string>> {
  const unique = [...new Map(vendorIds.map((id) => [id.toHexString(), id])).values()];
  if (unique.length === 0) return new Map();

  const vendors = await vendorsCollection();
  const docs = await vendors
    .find({ _id: { $in: unique } })
    .project<{ _id: ObjectId; externalId: string }>({ externalId: 1 })
    .toArray();
  return new Map(docs.map((doc) => [doc._id.toHexString(), doc.externalId]));
}

/** Serialize a monthly list for `/v1`, resolving each day's vendor to its
 * `externalId` in one batched query. */
export async function serializeV1MonthlyList(list: MonthlyList) {
  const vendorIds = list.entries.flatMap((entry) => (entry.vendorId ? [entry.vendorId] : []));
  return v1MonthlyList(list, await vendorExternalIdsByHex(vendorIds));
}
