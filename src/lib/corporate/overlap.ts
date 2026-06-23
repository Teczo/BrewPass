import { ObjectId } from "mongodb";

import { corporateAccountsCollection, ordersCollection, usersCollection } from "@/lib/collections";
import { canMemberDecline } from "@/lib/corporate/autonomy";
import type { CorporateAccount, Order } from "@/lib/models";
import { localDateOf } from "@/lib/time";

/**
 * Phase J.5 — same-day personal/office coexistence reconciliation.
 *
 * A member can hold both a personal and an office order on the same day; the two
 * bill to different cards, so this is NOT a billing conflict and the default is
 * to keep both (rule #17). The only interaction is advisory: the member may set
 * a standing "remember my choice" rule to auto-skip one side on overlap days, so
 * they are never prompted daily. Reconciliation only ever skips one side per the
 * member's explicit rule — neither account silently cancels the other.
 */

export type OverlapRule = NonNullable<import("@/lib/models").User["overlapRule"]>;

/** What to auto-skip on an overlap day, given the member's standing rule and
 * whether their company allows declining office coffee. Pure + unit-tested.
 * `skip_office` is only honored when the company permits declining (rule #18) —
 * otherwise we keep both rather than violate the autonomy gate. */
export function resolveOverlapAction(
  rule: OverlapRule | undefined,
  canDeclineOffice: boolean,
): "none" | "skip_personal" | "skip_office" {
  if (rule === "skip_personal") return "skip_personal";
  if (rule === "skip_office") return canDeclineOffice ? "skip_office" : "none";
  return "none";
}

/** Map a one-tap "cancel this side" choice to the standing rule to remember. */
export function ruleForChoice(cancel: "personal" | "office"): OverlapRule {
  return cancel === "personal" ? "skip_personal" : "skip_office";
}

export interface OverlapReconcileSummary {
  date: string;
  skippedPersonal: number;
  skippedOffice: number;
}

/**
 * Apply members' standing overlap rules for one day, after both personal and
 * office generation have run. Idempotent: only acts on still-`scheduled` orders
 * before their cutoff, so re-runs (and the post-skip state) are no-ops. Skips at
 * most one side per the member's rule; defaults (keep_both / unset) are left
 * completely untouched so the advisory notice can offer the choice instead.
 */
export async function reconcileOverlapsForDate(
  localDate: string,
  now: Date = new Date(),
): Promise<OverlapReconcileSummary> {
  const summary: OverlapReconcileSummary = {
    date: localDate,
    skippedPersonal: 0,
    skippedOffice: 0,
  };

  const orders = await ordersCollection();
  // Office orders are the rarer side — start from them to bound the work.
  const officeOrders = await orders
    .find({ date: localDate, status: "scheduled", source: "corporate" })
    .toArray();
  if (officeOrders.length === 0) return summary;

  const userIds = [
    ...new Map(officeOrders.map((o) => [o.userId.toHexString(), o.userId])).values(),
  ];

  const users = await usersCollection();
  // Only members who set a non-default standing rule are reconciled.
  const ruledUsers = await users
    .find({ _id: { $in: userIds }, overlapRule: { $in: ["skip_personal", "skip_office"] } })
    .toArray();
  if (ruledUsers.length === 0) return summary;

  const ruleByUser = new Map(ruledUsers.map((u) => [u._id.toHexString(), u.overlapRule]));
  const ruledUserIds = ruledUsers.map((u) => u._id);

  const personalOrders = await orders
    .find({
      date: localDate,
      status: "scheduled",
      source: "personal",
      userId: { $in: ruledUserIds },
    })
    .toArray();
  const personalByUser = new Map(personalOrders.map((o) => [o.userId.toHexString(), o]));

  // Resolve accounts once for the decline gate on the office side.
  const accountIds = [
    ...new Map(
      officeOrders
        .filter((o) => o.corporateAccountId)
        .map((o) => [o.corporateAccountId!.toHexString(), o.corporateAccountId!]),
    ).values(),
  ];
  const accounts = await corporateAccountsCollection();
  const accountDocs = await accounts.find({ _id: { $in: accountIds } }).toArray();
  const accountById = new Map<string, CorporateAccount>(
    accountDocs.map((a) => [a._id.toHexString(), a]),
  );

  const officeByUser = new Map<string, Order[]>();
  for (const order of officeOrders) {
    const key = order.userId.toHexString();
    const list = officeByUser.get(key);
    if (list) list.push(order);
    else officeByUser.set(key, [order]);
  }

  for (const user of ruledUsers) {
    const key = user._id.toHexString();
    const personal = personalByUser.get(key);
    const offices = officeByUser.get(key) ?? [];
    // Reconciliation is only meaningful when BOTH sides exist on the day.
    if (!personal || offices.length === 0) continue;

    const rule = ruleByUser.get(key);

    // Personal side: never gated by the company (it's the member's own coffee).
    if (resolveOverlapAction(rule, true) === "skip_personal") {
      const result = await orders.updateOne(
        { _id: personal._id, status: "scheduled", cutoffAt: { $gt: now } },
        { $set: { status: "skipped", modifiedByUserAt: now, updatedAt: now } },
      );
      summary.skippedPersonal += result.modifiedCount;
    }

    // Office side: each office is gated by its own company's decline setting via
    // the same pure decision function (rule #18). For a skip_personal rule this
    // resolves to "skip_personal" here too, so no office is touched.
    for (const office of offices) {
      const account = office.corporateAccountId
        ? accountById.get(office.corporateAccountId.toHexString())
        : undefined;
      if (
        resolveOverlapAction(rule, account ? canMemberDecline(account) : false) !== "skip_office"
      ) {
        continue;
      }
      const result = await orders.updateOne(
        { _id: office._id, status: "scheduled", cutoffAt: { $gt: now } },
        { $set: { status: "skipped", modifiedByUserAt: now, updatedAt: now } },
      );
      summary.skippedOffice += result.modifiedCount;
    }
  }

  return summary;
}

export interface OverlapOfficeView {
  orderId: string;
  membershipId: string | null;
  company: string;
  drink: string;
  /** Whether the member's company allows skipping this office coffee. */
  canDecline: boolean;
}

export interface OverlapDay {
  date: string;
  /** True while both orders are still before cutoff (the notice is actionable). */
  editable: boolean;
  personal: { orderId: string; drink: string };
  offices: OverlapOfficeView[];
}

/**
 * Upcoming days where the member has BOTH a scheduled personal and a scheduled
 * office coffee — the input for the advisory (non-blocking) overlap notice. Only
 * still-scheduled orders count, so a day already reconciled by a standing rule
 * (one side skipped) no longer appears.
 */
export async function findUserOverlaps(
  userId: ObjectId,
  now: Date = new Date(),
): Promise<OverlapDay[]> {
  const today = localDateOf(now);
  const orders = await ordersCollection();
  const scheduled = await orders
    .find({
      userId,
      date: { $gte: today },
      status: "scheduled",
      source: { $in: ["personal", "corporate"] },
    })
    .sort({ date: 1 })
    .toArray();

  const byDate = new Map<string, { personal?: Order; offices: Order[] }>();
  for (const order of scheduled) {
    const entry = byDate.get(order.date) ?? { offices: [] };
    if (order.source === "personal") entry.personal = order;
    else entry.offices.push(order);
    byDate.set(order.date, entry);
  }

  const overlapEntries = [...byDate.entries()].filter(
    ([, entry]) => entry.personal && entry.offices.length > 0,
  );
  if (overlapEntries.length === 0) return [];

  const accountIds = [
    ...new Map(
      overlapEntries
        .flatMap(([, entry]) => entry.offices)
        .filter((o) => o.corporateAccountId)
        .map((o) => [o.corporateAccountId!.toHexString(), o.corporateAccountId!]),
    ).values(),
  ];
  const accounts = await corporateAccountsCollection();
  const accountDocs = await accounts.find({ _id: { $in: accountIds } }).toArray();
  const accountById = new Map<string, CorporateAccount>(
    accountDocs.map((a) => [a._id.toHexString(), a]),
  );

  return overlapEntries.map(([date, entry]) => {
    const personal = entry.personal!;
    const editable =
      personal.cutoffAt.getTime() > now.getTime() &&
      entry.offices.every((o) => o.cutoffAt.getTime() > now.getTime());
    return {
      date,
      editable,
      personal: { orderId: personal._id.toHexString(), drink: personal.drink.drink },
      offices: entry.offices.map((office) => {
        const account = office.corporateAccountId
          ? accountById.get(office.corporateAccountId.toHexString())
          : undefined;
        return {
          orderId: office._id.toHexString(),
          membershipId: office.corporateMembershipId?.toHexString() ?? null,
          company: account?.company ?? "your office",
          drink: office.drink.drink,
          canDecline: account ? canMemberDecline(account) : false,
        };
      }),
    };
  });
}
