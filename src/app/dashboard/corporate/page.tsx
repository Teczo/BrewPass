import { redirect } from "next/navigation";

import {
  CorporateOwnerDashboard,
  type JoinCodeJson,
  type OwnerDashboardAccount,
} from "@/components/corporate-owner-dashboard";
import { CreateCorporateAccount } from "@/components/corporate-panel";
import { JoinCompanyPanel } from "@/components/join-company-panel";
import { OfficeCoffeeEditor } from "@/components/office-coffee-editor";
import { OfficeCoffeeTracker } from "@/components/office-coffee-tracker";
import { OfficePackPanel } from "@/components/office-pack-panel";
import { Card, SectionLabel } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
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
import { listMemberOfficeCoffees } from "@/lib/corporate/office-tracking";
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
  const [offices, officeCoffees, taxonomy] = await Promise.all([
    listMemberOffices(user._id),
    listMemberOfficeCoffees(user._id, new Date()),
    loadActiveTaxonomy(),
  ]);
  const memberDrinkOptions = drinkOptionsFrom(taxonomy) ?? DEFAULT_DRINK_OPTIONS;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[26px] leading-tight text-espresso">Office coffee</h1>
        <p className="text-sm text-coffee">
          Run your team&apos;s coffee, or join a company with a code. Billed per delivered office
          coffee on the company card — no seats.
        </p>
      </header>

      {params.card && (
        <Notice tone="sage" icon="✓">
          Company card saved — office coffee will be billed here per delivery.
        </Notice>
      )}
      {params.card_canceled && (
        <Notice tone="amber" icon="⚠️">
          Card setup canceled — no card was saved.
        </Notice>
      )}

      {/* Member-side: live tracking for the member's own office coffee (relocated
          here from Home in N.8). */}
      {officeCoffees.length > 0 && <OfficeCoffeeTracker items={officeCoffees} />}

      <JoinCompanyPanel offices={offices} />

      {/* Member-side: set your own office coffee (gated server-side by autonomy). */}
      {offices.length > 0 && <OfficeCoffeeEditor drinkOptions={memberDrinkOptions} />}

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
    <Card className="flex flex-col gap-3 p-5">
      <SectionLabel>Run coffee for your team</SectionLabel>
      <p className="text-sm text-coffee">
        Create a company to invite staff by code, set office defaults, and pay per delivered coffee
        on one company card.
      </p>
      <CreateCorporateAccount />
    </Card>
  );
}
