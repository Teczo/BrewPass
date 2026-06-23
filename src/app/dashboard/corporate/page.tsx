import Link from "next/link";
import { redirect } from "next/navigation";

import {
  CorporateOwnerDashboard,
  type JoinCodeJson,
  type OwnerDashboardAccount,
} from "@/components/corporate-owner-dashboard";
import { CreateCorporateAccount } from "@/components/corporate-panel";
import { JoinCompanyPanel } from "@/components/join-company-panel";
import { OfficePackPanel } from "@/components/office-pack-panel";
import {
  corporateAccountsCollection,
  corporateJoinCodesCollection,
  locationsCollection,
} from "@/lib/collections";
import {
  resolveMemberCanDecline,
  resolveMemberSelfSelect,
  resolveSelectionMode,
} from "@/lib/corporate/autonomy";
import { buildOwnerRoster, listMemberOffices } from "@/lib/corporate/roster";
import { drinkOptionsFrom, loadActiveTaxonomy } from "@/lib/taxonomy";
import { DEFAULT_DRINK_OPTIONS } from "@/lib/taxonomy-options";
import { tomorrowLocalDate } from "@/lib/time";
import { getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function CorporatePage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string; card_canceled?: string }>;
}) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/dashboard/corporate");

  const [params, accounts] = await Promise.all([searchParams, corporateAccountsCollection()]);
  const account = await accounts.findOne({ billingOwnerUserId: user._id });

  // Owner dashboard data (only when the user owns a company).
  let ownerProps: {
    account: OwnerDashboardAccount;
    locations: Array<{ id: string; label: string }>;
    drinkOptions: ReturnType<typeof drinkOptionsFrom>;
    joinCodes: JoinCodeJson[];
    roster: Awaited<ReturnType<typeof buildOwnerRoster>>;
  } | null = null;

  if (account) {
    const [locationsCol, joinCodesCol] = await Promise.all([
      locationsCollection(),
      corporateJoinCodesCollection(),
    ]);
    const [locationDocs, joinCodeDocs, roster, taxonomy] = await Promise.all([
      locationsCol.find({ userId: user._id }).sort({ createdAt: 1 }).toArray(),
      joinCodesCol
        .find({ corporateAccountId: account._id })
        .sort({ active: -1, createdAt: -1 })
        .toArray(),
      buildOwnerRoster(account),
      loadActiveTaxonomy(),
    ]);

    const defaults = account.officeDefaults;
    ownerProps = {
      account: {
        id: account._id.toHexString(),
        company: account.company,
        selectionMode: resolveSelectionMode(account),
        memberSelfSelect: resolveMemberSelfSelect(account),
        memberCanDecline: resolveMemberCanDecline(account),
        bundleDrink: account.bundleDrink ?? null,
        officeDefaults: defaults
          ? {
              drink: defaults.drink,
              schedule: defaults.schedule,
              locationId: defaults.locationId.toHexString(),
            }
          : null,
        cardOnFile: Boolean(account.companyStripePaymentMethodId),
      },
      locations: locationDocs.map((l) => ({ id: l._id.toHexString(), label: l.label })),
      drinkOptions: drinkOptionsFrom(taxonomy) ?? DEFAULT_DRINK_OPTIONS,
      joinCodes: joinCodeDocs.map((doc) => ({
        code: doc.code,
        type: doc.type,
        redemptionCap: doc.redemptionCap ?? null,
        redeemedCount: doc.redeemedCount,
        active: doc.active,
        rotatedAt: doc.rotatedAt?.toISOString() ?? null,
      })),
      roster,
    };
  }

  // Member-side: which companies the user belongs to (independent of ownership).
  const offices = await listMemberOffices(user._id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Office coffee</h1>
          <p className="text-sm text-neutral-500">
            Run your team&apos;s coffee, or join a company with a code. Billed per delivered office
            coffee on the company card — no seats.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-amber-800 hover:underline">
          ← Dashboard
        </Link>
      </header>

      {params.card && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Company card saved — office coffee will be billed here per delivery.
        </p>
      )}
      {params.card_canceled && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Card setup canceled — no card was saved.
        </p>
      )}

      <JoinCompanyPanel offices={offices} />

      {ownerProps ? (
        <>
          <CorporateOwnerDashboard
            account={ownerProps.account}
            locations={ownerProps.locations}
            drinkOptions={ownerProps.drinkOptions ?? DEFAULT_DRINK_OPTIONS}
            joinCodes={ownerProps.joinCodes}
            roster={ownerProps.roster}
          />
          <OfficePackPanel
            defaultDate={tomorrowLocalDate(new Date())}
            drinkOptions={ownerProps.drinkOptions ?? DEFAULT_DRINK_OPTIONS}
          />
        </>
      ) : (
        <CreateCorporateCta />
      )}
    </main>
  );
}

function CreateCorporateCta() {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="font-semibold">Run coffee for your team</h2>
      <p className="text-sm text-neutral-500">
        Create a company to invite staff by code, set office defaults, and pay per delivered coffee
        on one company card.
      </p>
      <CreateCorporateAccount />
    </section>
  );
}
