import { ObjectId } from "mongodb";

import { corporateAccountsCollection, ordersCollection, usersCollection } from "@/lib/collections";
import type { Order } from "@/lib/models";
import { escapeHtml, sendEmail, sendPushToUser } from "@/lib/notifications";
import { deliveryHourOf } from "@/lib/order-engine/routing";
import {
  loadRoutingCandidates,
  selectVendor,
  type RoutingCandidate,
} from "@/lib/order-engine/routing-data";
import { resolveCommissionBps } from "@/lib/payments/commission";
import { splitOrderAmount } from "@/lib/payments/money";
import { refundFailedDelivery } from "@/lib/payments/refund";
import { isoWeekdayOf, localDateOf, localTimeOf } from "@/lib/time";
import { emitOrderEvent } from "@/lib/webhooks/emit";

/**
 * Phase O.2 §2.5 (`fallbacks.md` §2.5) — a vendor goes offline AFTER the
 * customer was charged but BEFORE delivery. The day's coffee is already paid
 * for, so rather than refund first we try to rescue it: reassign each affected
 * order to another eligible vendor at the **snapshotted price** (the customer's
 * charge is unchanged; the platform absorbs any rate delta — rule #6), and only
 * if no vendor can be found do we fall through to the existing auto-refund
 * (rule #1). The original vendor was never paid (payout is delivery-gated,
 * rule #4), so there is nothing to claw back.
 *
 * Event-driven: called when a vendor transitions to a non-serving status
 * (paused/offline/suspended). Best-effort and idempotent — every mutation is
 * claimed on `(vendorId, status)` so a re-fire or concurrent call can't double
 * reassign or double refund.
 *
 * Scope: only `confirmed`/`preparing` charged orders (made but not yet handed to
 * a courier). Once `out_for_delivery` the courier holds the coffee — that is the
 * stuck-delivery / refund path (O.4), not a reassignment. Pack-pinned orders are
 * excluded (rule #20 — they skip/refund via the pack path, never reroute).
 */
export interface ReassignSummary {
  vendorId: string;
  scanned: number;
  reassigned: number;
  refunded: number;
}

/**
 * Whether a vendor status change should trigger §2.5 reassignment: the vendor
 * was serving (`active`) and just left it for a non-serving state. Earlier
 * non-serving transitions already rescued any charged orders, so we only fire
 * on the `active → {paused,offline,suspended}` edge. Pure + unit-tested.
 */
export function vendorWentOffline(prevStatus: string, nextStatus: string): boolean {
  return (
    prevStatus === "active" &&
    (nextStatus === "paused" || nextStatus === "offline" || nextStatus === "suspended")
  );
}

export async function reassignChargedOrdersForOfflineVendor(
  offlineVendorId: ObjectId,
  now: Date = new Date(),
): Promise<ReassignSummary> {
  const orders = await ordersCollection();
  const summary: ReassignSummary = {
    vendorId: offlineVendorId.toHexString(),
    scanned: 0,
    reassigned: 0,
    refunded: 0,
  };

  const affected = await orders
    .find({
      vendorId: offlineVendorId,
      status: { $in: ["confirmed", "preparing"] },
      chargeStatus: "charged",
      vendorPinned: { $ne: true },
    })
    .toArray();
  if (affected.length === 0) return summary;

  // Group by delivery date so each date's candidate set + capacity load once.
  const byDate = new Map<string, Order[]>();
  for (const order of affected) {
    const list = byDate.get(order.date);
    if (list) list.push(order);
    else byDate.set(order.date, [order]);
  }

  for (const [date, dateOrders] of byDate) {
    const candidates = await loadRoutingCandidates(date);
    const candidateByVendor = new Map<string, RoutingCandidate>(
      candidates.map((candidate) => [candidate.vendor._id.toHexString(), candidate]),
    );
    const weekday = isoWeekdayOf(date);

    for (const order of dateOrders) {
      summary.scanned += 1;
      const time = localTimeOf(order.deliverAt);

      const result = selectVendor(
        {
          // Emergency reroute auto-routes to the best available vendor.
          preferredVendorId: null,
          point: order.location.geo,
          date,
          weekday,
          time,
          drink: { drink: order.drink.drink, milk: order.drink.milk },
          nowLocalDate: localDateOf(now),
          nowLocalTime: localTimeOf(now),
          excludeVendorIds: [offlineVendorId, ...(order.declinedVendorIds ?? [])],
          // §2.5: the rescue happens after the accept-cutoff by definition.
          bypassAcceptCutoff: true,
        },
        candidates,
      );

      if (result.ok) {
        const candidate = candidateByVendor.get(result.vendorId.toHexString())!;
        // Customer charge (priceSen) is unchanged; recompute the commission
        // split at the rescue vendor's rate. Platform absorbs any price delta.
        const grossSen = order.priceSen ?? 0;
        const split =
          grossSen > 0
            ? splitOrderAmount(grossSen, await resolveCommissionBps(candidate.vendor))
            : null;

        const claim = await orders.updateOne(
          {
            _id: order._id,
            vendorId: offlineVendorId,
            status: { $in: ["confirmed", "preparing"] },
          },
          {
            $set: {
              vendorId: candidate.vendor._id,
              assignmentMethod: "reassigned" as const,
              ...(split
                ? {
                    commissionAmountSen: split.commissionSen,
                    vendorNetAmountSen: split.vendorNetSen,
                  }
                : {}),
              updatedAt: now,
            },
            // Never bounce back to the offline vendor on a later pass.
            $addToSet: { declinedVendorIds: offlineVendorId },
          },
        );
        if (claim.modifiedCount !== 1) continue; // already handled by another run
        summary.reassigned += 1;
        // Occupy a capacity slot for the rest of this run.
        candidate.assignedCount += 1;
        const hour = deliveryHourOf(time);
        candidate.assignedByHour[hour] = (candidate.assignedByHour[hour] ?? 0) + 1;
        await emitOrderEvent("vendor.assigned", { ...order, vendorId: candidate.vendor._id }, now, {
          vendorExternalIdHint: candidate.vendor.externalId,
          suffix: "reassigned",
        });
        continue;
      }

      // No rescue vendor → fail the day and auto-refund the customer in full.
      const claim = await orders.updateOne(
        {
          _id: order._id,
          vendorId: offlineVendorId,
          status: { $in: ["confirmed", "preparing"] },
        },
        {
          $set: {
            status: "failed" as const,
            failureReason: "vendor_offline_no_reassignment",
            updatedAt: now,
          },
        },
      );
      if (claim.modifiedCount !== 1) continue;
      summary.refunded += 1;
      // Idempotent refund (marks chargeStatus refunded, emits refund.issued).
      await refundFailedDelivery(order._id, now);
      await emitOrderEvent(
        "order.failed",
        { ...order, status: "failed", failureReason: "vendor_offline_no_reassignment" },
        now,
      );
      await notifyReassignmentRefund(order);
    }
  }
  return summary;
}

/**
 * Apologise to the customer (and, for office coffee, the team owner) when an
 * already-charged order couldn't be rescued and was refunded (§2.5/§4.4).
 * Best-effort — never throws; the refund itself has already gone through.
 */
async function notifyReassignmentRefund(order: Order): Promise<void> {
  try {
    const users = await usersCollection();
    const user = await users.findOne({ _id: order.userId });
    const title = "Your coffee was refunded";
    const body =
      `Sorry — the café for your ${order.drink.drink} on ${order.date} became unavailable and ` +
      `we couldn't find another in time, so we've refunded you in full. Tomorrow is unaffected.`;

    if (user) {
      const pushResult = await sendPushToUser(user, { title, body });
      if (pushResult.invalidTokens.length > 0) {
        await users.updateOne(
          { _id: user._id },
          { $pull: { fcmTokens: { $in: pushResult.invalidTokens } } },
        );
      }
      await sendEmail({
        to: user.email,
        subject: title,
        html: `<p>${escapeHtml(body)}</p>`,
      });
    }

    // Office coffee: also notify the billing owner (rule #4 / §4.4).
    if (order.source === "corporate" && order.corporateAccountId) {
      const accounts = await corporateAccountsCollection();
      const account = await accounts.findOne({ _id: order.corporateAccountId });
      if (account) {
        const owner = await users.findOne({ _id: account.billingOwnerUserId });
        if (owner) {
          const memberName = user?.name ?? "a team member";
          await sendEmail({
            to: owner.email,
            subject: "Office coffee refunded — café unavailable",
            html: `<p>${escapeHtml(
              `${memberName}'s office coffee on ${order.date} was refunded to the company card — ` +
                `the café became unavailable and no other could fulfil it in time.`,
            )}</p>`,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Reassignment-refund notify for ${order._id.toHexString()} failed:`, error);
  }
}
