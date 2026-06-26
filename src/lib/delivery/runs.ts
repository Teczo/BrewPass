import { ObjectId } from "mongodb";

import { deliveryRunsCollection, ordersCollection } from "@/lib/collections";
import {
  deriveRunStatus,
  groupOrdersIntoStops,
  validateRunComposition,
  type RunOrderView,
} from "@/lib/delivery/run-logic";
import { newDocumentMeta } from "@/lib/models";
import type { DeliveryRun, DropLocation, Order } from "@/lib/models";

/**
 * Phase L.1 / L.2 — thin DB orchestration for consolidated delivery runs. All
 * decisions live in the pure `run-logic` functions; this layer only reads/writes
 * Mongo. Server-only (critical rule #2).
 */

/** Project an Order down to what the run logic needs. */
function toRunOrderView(order: Order): RunOrderView {
  return {
    orderId: order._id,
    vendorId: order.vendorId,
    status: order.status,
    locationId: order.location.locationId,
    packPurchaseId: order.packPurchaseId,
    deliveryRunId: order.deliveryRunId,
  };
}

export type CreateRunResult = { ok: true; run: DeliveryRun } | { ok: false; reason: string };

export interface CreateRunInput {
  orderIds: ObjectId[];
  dropLocation: DropLocation;
  targetDeliveryTime: Date;
  corporateAccountId?: ObjectId;
}

/**
 * Group existing Orders into one consolidated `DeliveryRun`. Validates the
 * composition (rule #22 — ≥2 Orders, no Pack orders, one shared drop, none
 * already in a run, all still deliverable), groups them into per-vendor pickup
 * stops, links each Order back to the run, and inserts the run as `planned`.
 *
 * Idempotency: setting `deliveryRunId` is guarded so an Order already in a run
 * is never silently re-grouped; a missing/changed Order aborts the whole
 * creation rather than building a partial run.
 */
export async function createDeliveryRun(
  input: CreateRunInput,
  now: Date = new Date(),
): Promise<CreateRunResult> {
  const orders = await ordersCollection();
  const ids = dedupe(input.orderIds);
  const docs = await orders.find({ _id: { $in: ids } }).toArray();
  if (docs.length !== ids.length) return { ok: false, reason: "order_not_found" };

  const views = docs.map(toRunOrderView);
  const validation = validateRunComposition(views);
  if (!validation.ok) return { ok: false, reason: validation.reason };

  const pickupStops = groupOrdersIntoStops(views);
  const runId = new ObjectId();
  const run: DeliveryRun = {
    _id: runId,
    ...newDocumentMeta(),
    orderIds: ids,
    dropLocation: input.dropLocation,
    targetDeliveryTime: input.targetDeliveryTime,
    pickupStops,
    status: "planned",
    ...(input.corporateAccountId ? { corporateAccountId: input.corporateAccountId } : {}),
    createdAt: now,
    updatedAt: now,
  };

  // Link the Orders first, guarded so we never poach an Order that raced into
  // another run. If we can't claim them all, roll back and abort.
  const claim = await orders.updateMany(
    { _id: { $in: ids }, deliveryRunId: { $exists: false } },
    { $set: { deliveryRunId: runId, updatedAt: now } },
  );
  if (claim.modifiedCount !== ids.length) {
    await orders.updateMany(
      { _id: { $in: ids }, deliveryRunId: runId },
      {
        $unset: { deliveryRunId: "" },
        $set: { updatedAt: now },
      },
    );
    return { ok: false, reason: "already_in_run" };
  }

  const runs = await deliveryRunsCollection();
  await runs.insertOne(run);
  return { ok: true, run };
}

/**
 * Recompute and persist a run's aggregate status from its member Orders'
 * current statuses (L.2). Best-effort and read-only with respect to money: it
 * never touches charging, payout, or refunds — those are gated strictly
 * per-Order. Returns the derived status (or null if the run is gone).
 */
export async function recomputeRunStatus(
  runId: ObjectId,
  now: Date = new Date(),
): Promise<DeliveryRun["status"] | null> {
  const runs = await deliveryRunsCollection();
  const run = await runs.findOne({ _id: runId });
  if (!run) return null;

  const orders = await ordersCollection();
  const members = await orders.find({ _id: { $in: run.orderIds } }).toArray();
  const status = deriveRunStatus(
    members.map((o) => o.status),
    { dispatched: run.status === "dispatched" || run.courierRunId != null },
  );
  if (status !== run.status) {
    await runs.updateOne({ _id: runId }, { $set: { status, updatedAt: now } });
  }
  return status;
}

function dedupe(ids: ObjectId[]): ObjectId[] {
  const seen = new Map<string, ObjectId>();
  for (const id of ids) seen.set(id.toHexString(), id);
  return [...seen.values()];
}
