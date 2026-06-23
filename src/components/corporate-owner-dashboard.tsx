"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { DrinkOptions } from "@/lib/taxonomy-options";

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export interface DrinkSpecJson {
  drink: string;
  size: "small" | "regular" | "large";
  milk: string;
  sugar: number;
  strength: "mild" | "regular" | "strong" | "double";
}

export interface ScheduleJson {
  days: number[];
  time: string;
}

export interface OfficeDefaultsJson {
  drink: DrinkSpecJson;
  schedule: ScheduleJson;
  locationId: string;
}

export interface JoinCodeJson {
  code: string;
  type: "reusable" | "single_use";
  redemptionCap: number | null;
  redeemedCount: number;
  active: boolean;
  rotatedAt: string | null;
}

export interface RosterOrderJson {
  date: string;
  drink: string;
  status: string;
  intent: "want" | "skip" | "other";
  editable: boolean;
}

export interface RosterMemberJson {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  officeSet: boolean;
  today: RosterOrderJson | null;
  tomorrow: RosterOrderJson | null;
}

export interface OwnerDashboardAccount {
  id: string;
  company: string;
  selectionMode: "bundle" | "individual";
  memberSelfSelect: boolean;
  memberCanDecline: boolean;
  bundleDrink: DrinkSpecJson | null;
  officeDefaults: OfficeDefaultsJson | null;
  cardOnFile: boolean;
}

export interface OwnerDashboardProps {
  account: OwnerDashboardAccount;
  locations: Array<{ id: string; label: string }>;
  drinkOptions: DrinkOptions;
  joinCodes: JoinCodeJson[];
  roster: { today: string; tomorrow: string; members: RosterMemberJson[] };
}

const DEFAULT_SPEC: DrinkSpecJson = {
  drink: "Flat White",
  size: "regular",
  milk: "Fresh milk",
  sugar: 0,
  strength: "regular",
};

/** Shared action runner: POST/PUT/PATCH/DELETE a corporate endpoint, surface
 * the error, follow a returned Stripe `url`, otherwise refresh server data. */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(url: string, method: string, payload?: object): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Action failed");
      if (body?.url) {
        window.location.assign(body.url as string);
        return true;
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function DrinkFields({
  spec,
  options,
  onChange,
}: {
  spec: DrinkSpecJson;
  options: DrinkOptions;
  onChange: (spec: DrinkSpecJson) => void;
}) {
  const milks = options.milks.length > 0 ? options.milks : [{ value: spec.milk, label: spec.milk }];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        Drink
        <select
          className="rounded-md border border-neutral-300 px-2 py-1.5"
          value={spec.drink}
          onChange={(e) => onChange({ ...spec, drink: e.target.value })}
        >
          {options.drinks.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Size
        <select
          className="rounded-md border border-neutral-300 px-2 py-1.5"
          value={spec.size}
          onChange={(e) => onChange({ ...spec, size: e.target.value as DrinkSpecJson["size"] })}
        >
          {options.sizes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Milk
        <select
          className="rounded-md border border-neutral-300 px-2 py-1.5"
          value={spec.milk}
          onChange={(e) => onChange({ ...spec, milk: e.target.value })}
        >
          {milks.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Strength
        <select
          className="rounded-md border border-neutral-300 px-2 py-1.5"
          value={spec.strength}
          onChange={(e) =>
            onChange({ ...spec, strength: e.target.value as DrinkSpecJson["strength"] })
          }
        >
          {options.strengths.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Sugar
        <input
          type="number"
          min={0}
          max={5}
          className="rounded-md border border-neutral-300 px-2 py-1.5"
          value={spec.sugar}
          onChange={(e) =>
            onChange({ ...spec, sugar: Math.max(0, Math.min(5, Number(e.target.value))) })
          }
        />
      </label>
    </div>
  );
}

function OfficeDefaultsForm({
  account,
  locations,
  drinkOptions,
  run,
  busy,
}: {
  account: OwnerDashboardAccount;
  locations: Array<{ id: string; label: string }>;
  drinkOptions: DrinkOptions;
  run: ReturnType<typeof useAction>["run"];
  busy: boolean;
}) {
  const existing = account.officeDefaults;
  const [spec, setSpec] = useState<DrinkSpecJson>(existing?.drink ?? DEFAULT_SPEC);
  const [days, setDays] = useState<number[]>(existing?.schedule.days ?? [1, 2, 3, 4, 5]);
  const [time, setTime] = useState(existing?.schedule.time ?? "08:30");
  const [locationId, setLocationId] = useState(existing?.locationId ?? locations[0]?.id ?? "");

  function toggleDay(day: number) {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  if (locations.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Add an office location under{" "}
        <a href="/onboarding/locations" className="text-amber-800 hover:underline">
          Locations
        </a>{" "}
        first — office coffee is delivered there.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-500">
        The default coffee, schedule, and delivery location every member&apos;s office coffee starts
        from. In bundle mode this drink is overridden by the bundle coffee below.
      </p>
      <DrinkFields spec={spec} options={drinkOptions} onChange={setSpec} />
      <div className="flex flex-wrap gap-1">
        {WEEKDAYS.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => toggleDay(d.value)}
            className={`rounded-md border px-2 py-1 text-xs font-medium ${
              days.includes(d.value)
                ? "border-amber-800 bg-amber-800 text-white"
                : "border-neutral-300 text-neutral-600"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Time
          <input
            type="time"
            className="rounded-md border border-neutral-300 px-2 py-1.5"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Office location
          <select
            className="rounded-md border border-neutral-300 px-2 py-1.5"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || days.length === 0 || !locationId}
          onClick={() =>
            run("/api/corporate/office-defaults", "PUT", {
              drink: spec,
              schedule: { days, time },
              locationId,
            })
          }
          className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Save office defaults
        </button>
      </div>
    </div>
  );
}

function intentBadge(order: RosterOrderJson | null) {
  if (!order) return <span className="text-xs text-neutral-400">—</span>;
  const cls =
    order.intent === "skip"
      ? "bg-neutral-100 text-neutral-500"
      : order.intent === "want"
        ? "bg-amber-100 text-amber-900"
        : "bg-green-100 text-green-800";
  const label =
    order.intent === "skip" ? "Skipped" : order.intent === "want" ? "Want" : order.status;
  return (
    <span className="flex flex-col gap-0.5">
      <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
      <span className="text-xs text-neutral-400">{order.drink}</span>
    </span>
  );
}

export function CorporateOwnerDashboard({
  account,
  locations,
  drinkOptions,
  joinCodes,
  roster,
}: OwnerDashboardProps) {
  const { run, busy, error } = useAction();
  const [bundleSpec, setBundleSpec] = useState<DrinkSpecJson>(account.bundleDrink ?? DEFAULT_SPEC);

  const canToggleWant = account.memberCanDecline;
  const reusableCode = joinCodes.find((c) => c.type === "reusable" && c.active) ?? null;

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard unavailable — the code is visible to copy manually */
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Section title="Office coffee setup">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">Company card</span>
            <span className="ml-2 text-neutral-500">
              {account.cardOnFile
                ? "On file — office coffee is billed here per delivery."
                : "Not set — office coffee can't be generated until a card is on file."}
            </span>
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => run("/api/corporate/company-card", "POST")}
            className="shrink-0 rounded-md border border-amber-800 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
          >
            {account.cardOnFile ? "Replace card" : "Add company card"}
          </button>
        </div>
        <OfficeDefaultsForm
          account={account}
          locations={locations}
          drinkOptions={drinkOptions}
          run={run}
          busy={busy}
        />
      </Section>

      <Section title="Member autonomy">
        <p className="text-sm text-neutral-500">
          Control how much members manage their own office coffee. These rules are enforced on the
          server for every member action.
        </p>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap gap-2">
            {(["individual", "bundle"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    "/api/corporate/settings",
                    "PUT",
                    // Bundle mode requires a bundle coffee — send the current one
                    // so the switch is atomic and passes server validation.
                    mode === "bundle"
                      ? { selectionMode: "bundle", bundleDrink: account.bundleDrink ?? bundleSpec }
                      : { selectionMode: "individual" },
                  )
                }
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  account.selectionMode === mode
                    ? "border-amber-800 bg-amber-800 text-white"
                    : "border-neutral-300 text-neutral-600"
                } disabled:opacity-50`}
              >
                {mode === "individual"
                  ? "Individual — each picks their own"
                  : "Bundle — one for all"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={account.memberSelfSelect}
              disabled={busy}
              onChange={(e) =>
                run("/api/corporate/settings", "PUT", { memberSelfSelect: e.target.checked })
              }
            />
            Members may choose/edit their own office coffee (individual mode only)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={account.memberCanDecline}
              disabled={busy}
              onChange={(e) =>
                run("/api/corporate/settings", "PUT", { memberCanDecline: e.target.checked })
              }
            />
            Members (and you, on their behalf) may skip a day&apos;s office coffee
          </label>
        </div>

        {account.selectionMode === "bundle" && (
          <div className="flex flex-col gap-2 rounded-md bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">Bundle coffee — everyone gets this</p>
            <DrinkFields spec={bundleSpec} options={drinkOptions} onChange={setBundleSpec} />
            <button
              type="button"
              disabled={busy}
              onClick={() => run("/api/corporate/settings", "PUT", { bundleDrink: bundleSpec })}
              className="w-fit rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Save bundle coffee
            </button>
          </div>
        )}
      </Section>

      <Section title="Join code">
        <p className="text-sm text-neutral-500">
          Share a code so staff self-join — no emails to manage. Joining never touches their
          personal BrewPass account.
        </p>
        {reusableCode ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-neutral-100 px-3 py-1.5 font-mono text-lg tracking-widest">
              {reusableCode.code}
            </code>
            <span className="text-xs text-neutral-500">
              {reusableCode.redeemedCount} joined
              {reusableCode.redemptionCap !== null ? ` / ${reusableCode.redemptionCap} cap` : ""}
            </span>
            <button
              type="button"
              onClick={() => copyCode(reusableCode.code)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Copy
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run("/api/corporate/join-codes", "POST", { type: "reusable" })}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Rotate
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run("/api/corporate/join-codes", "DELETE", { code: reusableCode.code })
              }
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Revoke
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => run("/api/corporate/join-codes", "POST", { type: "reusable" })}
            className="w-fit rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Generate join code
          </button>
        )}
      </Section>

      <Section title={`Team (${roster.members.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-neutral-400 uppercase">
              <tr>
                <th className="py-2">Member</th>
                <th className="py-2">Office coffee</th>
                <th className="py-2">Today ({roster.today.slice(5)})</th>
                <th className="py-2">Tomorrow ({roster.tomorrow.slice(5)})</th>
              </tr>
            </thead>
            <tbody>
              {roster.members.map((member) => (
                <tr key={member.membershipId} className="border-t border-neutral-100 align-top">
                  <td className="py-2">
                    <span className="font-medium">{member.name || "(no name)"}</span>
                    <br />
                    <span className="text-xs text-neutral-500">{member.email}</span>
                  </td>
                  <td className="py-2">
                    {member.officeSet ? (
                      <span className="text-xs text-green-700">Set up</span>
                    ) : (
                      <span className="text-xs text-neutral-400">Not set</span>
                    )}
                  </td>
                  {(["today", "tomorrow"] as const).map((day) => {
                    const order = member[day];
                    return (
                      <td key={day} className="py-2">
                        {intentBadge(order)}
                        {order?.editable && canToggleWant && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              run("/api/corporate/member-order", "POST", {
                                membershipId: member.membershipId,
                                date: order.date,
                                action: order.intent === "skip" ? "want" : "skip",
                              })
                            }
                            className="mt-1 block text-xs text-amber-800 hover:underline disabled:opacity-50"
                          >
                            {order.intent === "skip" ? "Mark want" : "Skip"}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {roster.members.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-sm text-neutral-400">
                    No members yet — share your join code above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
