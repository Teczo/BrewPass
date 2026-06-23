import type { ObjectId } from "mongodb";

import {
  corporateAccountsCollection,
  corporateMembershipsCollection,
  ordersCollection,
  preferencesCollection,
  usersCollection,
} from "@/lib/collections";
import type { CorporateAccount, Order } from "@/lib/models";
import { officeScope } from "@/lib/preferences";
import { localDateOf, tomorrowLocalDate } from "@/lib/time";

/**
 * Phase J.4 — owner visibility. These read-only builders assemble the per-member
 * picture the owner sees (joined, office coffee set, today's/tomorrow's
 * selection, want vs skip, delivery status) and the member's own "which offices
 * do I belong to" list. No mutation happens here — office want/skip changes go
 * through the server-authoritative member-order route so the J.3/J.4 autonomy
 * gate can never be bypassed (rule #18).
 */

/** want = the office coffee is on (scheduled), skip = the member opted out,
 * other = it has progressed into the delivery lifecycle (charged onward). */
export type OfficeIntent = "want" | "skip" | "other";

export interface RosterOrderView {
  orderId: string;
  date: string;
  drink: string;
  status: Order["status"];
  intent: OfficeIntent;
  /** True while the order is still editable (before its cutoff). */
  editable: boolean;
}

export interface RosterMemberView {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  /** Whether the member's office coffee has been configured/seeded yet. */
  officeSet: boolean;
  today: RosterOrderView | null;
  tomorrow: RosterOrderView | null;
}

export interface OwnerRoster {
  today: string;
  tomorrow: string;
  members: RosterMemberView[];
}

function toOrderView(order: Order | undefined, now: Date): RosterOrderView | null {
  if (!order) return null;
  const intent: OfficeIntent =
    order.status === "skipped" ? "skip" : order.status === "scheduled" ? "want" : "other";
  return {
    orderId: order._id.toHexString(),
    date: order.date,
    drink: order.drink.drink,
    status: order.status,
    intent,
    editable:
      (order.status === "scheduled" || order.status === "skipped") &&
      order.cutoffAt.getTime() > now.getTime(),
  };
}

/** Per-member roster for an owner's company (active members only). */
export async function buildOwnerRoster(
  account: CorporateAccount,
  now: Date = new Date(),
): Promise<OwnerRoster> {
  const today = localDateOf(now);
  const tomorrow = tomorrowLocalDate(now);

  const memberships = await corporateMembershipsCollection();
  const memberDocs = await memberships
    .find({ corporateAccountId: account._id, status: "active" })
    .sort({ joinedAt: 1 })
    .toArray();

  if (memberDocs.length === 0) {
    return { today, tomorrow, members: [] };
  }

  const membershipIds = memberDocs.map((m) => m._id);
  const userIds = memberDocs.map((m) => m.userId);

  const [users, preferences, orders] = await Promise.all([
    usersCollection(),
    preferencesCollection(),
    ordersCollection(),
  ]);

  const [userDocs, officePrefs, orderDocs] = await Promise.all([
    users.find({ _id: { $in: userIds } }).toArray(),
    // Office preferences are scoped by membership id; their existence is our
    // proxy for "office coffee has been set up" for that member.
    preferences.find({ scope: { $in: membershipIds.map((id) => officeScope(id)) } }).toArray(),
    orders
      .find({
        source: "corporate",
        corporateAccountId: account._id,
        date: { $in: [today, tomorrow] },
      })
      .toArray(),
  ]);

  const userById = new Map(userDocs.map((u) => [u._id.toHexString(), u]));
  const officeSetScopes = new Set(officePrefs.map((p) => p.scope));
  const orderByKey = new Map<string, Order>();
  for (const order of orderDocs) {
    if (order.corporateMembershipId) {
      orderByKey.set(`${order.corporateMembershipId.toHexString()}:${order.date}`, order);
    }
  }

  const members: RosterMemberView[] = memberDocs.map((membership) => {
    const memHex = membership._id.toHexString();
    const member = userById.get(membership.userId.toHexString());
    return {
      membershipId: memHex,
      userId: membership.userId.toHexString(),
      name: member?.name ?? "",
      email: member?.email ?? "",
      officeSet: officeSetScopes.has(officeScope(membership._id)),
      today: toOrderView(orderByKey.get(`${memHex}:${today}`), now),
      tomorrow: toOrderView(orderByKey.get(`${memHex}:${tomorrow}`), now),
    };
  });

  return { today, tomorrow, members };
}

export interface MemberOfficeView {
  membershipId: string;
  company: string;
  joinedVia: string;
}

/** The active company memberships a member belongs to (for the member view). */
export async function listMemberOffices(userId: ObjectId): Promise<MemberOfficeView[]> {
  const memberships = await corporateMembershipsCollection();
  const memberDocs = await memberships.find({ userId, status: "active" }).toArray();
  if (memberDocs.length === 0) return [];

  const accounts = await corporateAccountsCollection();
  const accountDocs = await accounts
    .find({ _id: { $in: memberDocs.map((m) => m.corporateAccountId) } })
    .toArray();
  const accountById = new Map(accountDocs.map((a) => [a._id.toHexString(), a]));

  return memberDocs.map((membership) => ({
    membershipId: membership._id.toHexString(),
    company: accountById.get(membership.corporateAccountId.toHexString())?.company ?? "(unknown)",
    joinedVia: membership.joinedVia,
  }));
}
