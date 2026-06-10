import Link from "next/link";
import { redirect } from "next/navigation";

import {
  CorporateManager,
  CreateCorporateAccount,
  type CorporateAccountJson,
} from "@/components/corporate-panel";
import { corporateMemberSubKey } from "@/lib/billing";
import {
  corporateAccountsCollection,
  subscriptionsCollection,
  usersCollection,
} from "@/lib/collections";
import { getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function CorporatePage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/dashboard/corporate");

  const [params, accounts] = await Promise.all([searchParams, corporateAccountsCollection()]);
  const account = await accounts.findOne({ billingOwnerUserId: user._id });

  let accountJson: CorporateAccountJson | null = null;
  if (account) {
    const [users, subscriptions] = await Promise.all([
      usersCollection(),
      subscriptionsCollection(),
    ]);
    const [memberDocs, memberSubs] = await Promise.all([
      users.find({ _id: { $in: account.memberUserIds } }).toArray(),
      subscriptions
        .find({
          stripeSubscriptionId: {
            $in: account.memberUserIds.map((id) => corporateMemberSubKey(account._id, id)),
          },
        })
        .toArray(),
    ]);
    const subByUserId = new Map(memberSubs.map((sub) => [sub.userId.toHexString(), sub]));

    accountJson = {
      id: account._id.toHexString(),
      company: account.company,
      seatCount: account.seatCount,
      status: account.status ?? null,
      currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
      members: memberDocs.map((member) => {
        const sub = subByUserId.get(member._id.toHexString());
        return {
          id: member._id.toHexString(),
          name: member.name,
          email: member.email,
          quotaUsed: sub?.quota.used ?? null,
          quotaTotal: sub?.quota.total ?? null,
        };
      }),
    };
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Corporate</h1>
          <p className="text-sm text-neutral-500">
            One subscription, RM199 per seat — every member gets 22 coffees a month.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-amber-800 hover:underline">
          ← Dashboard
        </Link>
      </header>

      {params.success && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Company subscription confirmed — add your team below.
        </p>
      )}
      {params.canceled && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Checkout canceled — no charge was made.
        </p>
      )}

      {accountJson ? <CorporateManager account={accountJson} /> : <CreateCorporateAccount />}
    </main>
  );
}
