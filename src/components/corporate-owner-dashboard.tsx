"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonClasses } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
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

const SELECT_CLASS =
  "rounded-xl border border-border bg-field px-3 py-2 text-sm font-medium text-ink focus:border-coffee focus:outline-none";

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
    <Card className="flex flex-col gap-3 p-5">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </Card>
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
      <label className="flex flex-col gap-1 text-sm text-coffee">
        Drink
        <select
          className={SELECT_CLASS}
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
      <label className="flex flex-col gap-1 text-sm text-coffee">
        Size
        <select
          className={SELECT_CLASS}
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
      <label className="flex flex-col gap-1 text-sm text-coffee">
        Milk
        <select
          className={SELECT_CLASS}
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
      <label className="flex flex-col gap-1 text-sm text-coffee">
        Strength
        <select
          className={SELECT_CLASS}
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
      <label className="flex flex-col gap-1 text-sm text-coffee">
        Sugar
        <input
          type="number"
          min={0}
          max={5}
          className={SELECT_CLASS}
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
      <p className="text-sm text-muted">
        Add an office location under{" "}
        <a href="/onboarding/locations" className="font-semibold text-coffee hover:underline">
          Locations
        </a>{" "}
        first — office coffee is delivered there.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-coffee">
        The default coffee, schedule, and delivery location every member&apos;s office coffee starts
        from. In bundle mode this drink is overridden by the bundle coffee below.
      </p>
      <DrinkFields spec={spec} options={drinkOptions} onChange={setSpec} />
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((d) => (
          <Chip
            key={d.value}
            selected={days.includes(d.value)}
            onClick={() => toggleDay(d.value)}
            className="px-3"
          >
            {d.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-coffee">
          Time
          <input
            type="time"
            className={SELECT_CLASS}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-coffee">
          Office location
          <select
            className={SELECT_CLASS}
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
        <Button
          disabled={busy || days.length === 0 || !locationId}
          onClick={() =>
            run("/api/corporate/office-defaults", "PUT", {
              drink: spec,
              schedule: { days, time },
              locationId,
            })
          }
        >
          Save office defaults
        </Button>
      </div>
    </div>
  );
}

function intentBadge(order: RosterOrderJson | null) {
  if (!order) return <span className="text-xs text-muted">—</span>;
  const tone: StatusTone =
    order.intent === "skip" ? "skipped" : order.intent === "want" ? "scheduled" : "active";
  const label =
    order.intent === "skip" ? "Skipped" : order.intent === "want" ? "Want" : order.status;
  return (
    <span className="flex flex-col gap-0.5">
      <StatusPill tone={tone}>{label}</StatusPill>
      <span className="text-xs text-muted">{order.drink}</span>
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
  const [cap, setCap] = useState("");

  const canToggleWant = account.memberCanDecline;
  const reusableCode = joinCodes.find((c) => c.type === "reusable" && c.active) ?? null;
  const singleUseCodes = joinCodes.filter((c) => c.type === "single_use" && c.active);

  // Phase O.6 (fallbacks.md §8.4/§8.8) — owner setup checklist. Office orders
  // only generate once the company card + office defaults are set (and, in
  // bundle mode, the bundle coffee). The join code is needed for members to
  // join but isn't itself a generation blocker. This surfaces the same skip
  // reasons the 8 PM cron already enforces server-side.
  const bundleMode = account.selectionMode === "bundle";
  const setupItems = [
    { key: "card", label: "Company card", done: account.cardOnFile },
    { key: "defaults", label: "Office defaults", done: account.officeDefaults != null },
    ...(bundleMode
      ? [{ key: "bundle", label: "Bundle coffee", done: account.bundleDrink != null }]
      : []),
    {
      key: "code",
      label: "Join code",
      done: reusableCode != null || singleUseCodes.length > 0,
    },
  ];
  const setupComplete = setupItems.every((item) => item.done);
  const generationBlockers = setupItems.filter((item) => item.key !== "code" && !item.done);

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard unavailable — the code is visible to copy manually */
    }
  }

  // Setting a limit rotates the standing code (the API has no edit-without-rotate),
  // so the cap is applied as part of generating/rotating.
  function generateReusable() {
    const trimmed = cap.trim();
    const capValue = trimmed ? Number(trimmed) : undefined;
    void run("/api/corporate/join-codes", "POST", {
      type: "reusable",
      ...(capValue && capValue > 0 ? { redemptionCap: capValue } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <p className="text-sm text-terracotta">{error}</p>}

      {!setupComplete && (
        <Section title="Finish office setup">
          <ul className="flex flex-col gap-1.5 text-sm">
            {setupItems.map((item) => (
              <li key={item.key} className="flex items-center gap-2">
                <span className={item.done ? "text-sage" : "text-muted"} aria-hidden>
                  {item.done ? "✓" : "○"}
                </span>
                <span className={item.done ? "text-espresso" : "text-coffee"}>{item.label}</span>
                {!item.done && <span className="text-xs text-muted">— not set</span>}
              </li>
            ))}
          </ul>
          {generationBlockers.length > 0 && (
            <p className="text-sm text-terracotta">
              Office coffee starts once you set{" "}
              {generationBlockers.map((b) => b.label.toLowerCase()).join(" and ")}.
              {bundleMode &&
                !account.bundleDrink &&
                " In bundle mode the bundle coffee is the one everyone gets."}
            </p>
          )}
        </Section>
      )}

      <Section title="Office coffee setup">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-espresso">Company card</span>
              <StatusPill tone={account.cardOnFile ? "active" : "skipped"}>
                {account.cardOnFile ? "Active" : "Not set"}
              </StatusPill>
            </div>
            <span className="text-sm text-coffee">
              {account.cardOnFile
                ? "Every delivered office coffee is charged here — never a member's card."
                : "Office coffee can't be generated until a card is on file."}
            </span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => run("/api/corporate/company-card", "POST")}
            className={buttonClasses("secondary", "shrink-0")}
          >
            {account.cardOnFile ? "Replace card" : "Add card"}
          </button>
        </div>
        <p className="text-sm text-muted">No seats — you pay per delivered coffee.</p>
        <OfficeDefaultsForm
          account={account}
          locations={locations}
          drinkOptions={drinkOptions}
          run={run}
          busy={busy}
        />
      </Section>

      <Section title="Member autonomy">
        <p className="text-sm text-coffee">
          Control how much members manage their own office coffee. These rules are enforced on the
          server for every member action.
        </p>
        <div className="flex gap-2 rounded-full bg-paper p-1">
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
              className={cn(
                "flex-1 rounded-full px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50",
                account.selectionMode === mode ? "bg-espresso text-white" : "text-coffee",
              )}
            >
              {mode === "individual" ? "Individual — each picks" : "Bundle — one for all"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-coffee">
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
        <label className="flex items-center gap-2 text-sm text-coffee">
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

        {account.selectionMode === "bundle" && (
          <div className="flex flex-col gap-2 rounded-2xl bg-amber p-4">
            <p className="text-sm font-semibold text-amber-ink">Bundle coffee — everyone gets this</p>
            <DrinkFields spec={bundleSpec} options={drinkOptions} onChange={setBundleSpec} />
            <Button
              disabled={busy}
              onClick={() => run("/api/corporate/settings", "PUT", { bundleDrink: bundleSpec })}
              className="self-start"
            >
              Save bundle coffee
            </Button>
          </div>
        )}
      </Section>

      <Section title="Join code">
        <p className="text-sm text-coffee">
          Share a code so staff self-join — no emails to manage. Joining never touches their
          personal BrewPass account.
        </p>
        {reusableCode ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-xl bg-paper px-3 py-1.5 font-mono text-lg tracking-widest text-espresso">
                {reusableCode.code}
              </code>
              <span className="font-mono text-xs text-muted">
                {reusableCode.redeemedCount} joined
                {reusableCode.redemptionCap !== null ? ` · limit ${reusableCode.redemptionCap}` : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copyCode(reusableCode.code)}
                className={buttonClasses("secondary")}
              >
                Copy
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={generateReusable}
                className={buttonClasses("secondary")}
              >
                Rotate
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run("/api/corporate/join-codes", "DELETE", { code: reusableCode.code })}
                className={buttonClasses("danger")}
              >
                Revoke
              </button>
            </div>
          </>
        ) : (
          <Button disabled={busy} onClick={generateReusable} className="self-start">
            Generate join code
          </Button>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-coffee">
            Join limit (optional, applied on generate/rotate)
            <input
              type="number"
              min={1}
              placeholder="no limit"
              className={SELECT_CLASS}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
          </label>
        </div>

        <div className="flex flex-col gap-2 border-t border-hairline pt-3">
          <p className="text-sm text-coffee">
            Tighter control? Mint single-use invite codes — each works once.
          </p>
          {singleUseCodes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {singleUseCodes.map((c) => (
                <code
                  key={c.code}
                  className="rounded-lg bg-paper px-2 py-1 font-mono text-sm tracking-widest text-espresso"
                >
                  {c.code}
                </code>
              ))}
            </div>
          )}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => run("/api/corporate/join-codes", "POST", { type: "single_use" })}
            className="self-start"
          >
            Mint single-use code
          </Button>
        </div>
      </Section>

      <Section title={`Team (${roster.members.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-muted uppercase">
              <tr>
                <th className="py-2">Member</th>
                <th className="py-2">Office coffee</th>
                <th className="py-2">Today ({roster.today.slice(5)})</th>
                <th className="py-2">Tomorrow ({roster.tomorrow.slice(5)})</th>
              </tr>
            </thead>
            <tbody>
              {roster.members.map((member) => (
                <tr key={member.membershipId} className="border-t border-hairline align-top">
                  <td className="py-2">
                    <span className="font-semibold text-espresso">{member.name || "(no name)"}</span>
                    <br />
                    <span className="text-xs text-muted">{member.email}</span>
                  </td>
                  <td className="py-2">
                    {member.officeSet ? (
                      <StatusPill tone="active">Set up</StatusPill>
                    ) : (
                      <span className="text-xs text-muted">Not set</span>
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
                            className="mt-1 block text-xs font-semibold text-coffee hover:underline disabled:opacity-50"
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
                  <td colSpan={4} className="py-3 text-sm text-muted">
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
