"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Notice } from "@/components/ui/notice";
import { DEFAULT_DRINK_OPTIONS, ensureOption, type DrinkOptions } from "@/lib/taxonomy-options";

const WEEKDAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SUGAR_LEVELS = [0, 1, 2, 3, 4, 5];

interface DrinkSpec {
  drink: string;
  size: string;
  milk: string;
  sugar: number;
  strength: string;
}

interface OfficePreference {
  defaultDrink: DrinkSpec;
  schedule: { days: number[]; time: string };
}

interface Office {
  membershipId: string;
  company: string | null;
  canSelfSelect: boolean;
  locationLabel: string | null;
  preference: OfficePreference | null;
}

function scheduleLabel(schedule: { days: number[]; time: string }): string {
  const days = schedule.days.map((d) => WEEKDAY_LABELS[d]).join(", ");
  return `${days} · ${schedule.time}`;
}

/**
 * Phase N.8b — member "Set your office coffee" editor. Self-fetches the
 * member's office preference(s); edits drink only (the schedule + location stay
 * owner-controlled). Editing is gated server-side by the office-preference PUT
 * (rule #18) and only offered when `canSelfSelect` is on; otherwise the office
 * coffee shows read-only as "Set by your company".
 */
export function OfficeCoffeeEditor({
  drinkOptions = DEFAULT_DRINK_OPTIONS,
}: {
  drinkOptions?: DrinkOptions;
}) {
  const [offices, setOffices] = useState<Office[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/corporate/office-preference")
      .then((r) => r.json())
      .then((body) => {
        if (active) setOffices((body?.offices as Office[]) ?? []);
      })
      .catch(() => {
        if (active) setOffices([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!offices || offices.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {offices.map((office) => (
        <OfficeCard key={office.membershipId} office={office} drinkOptions={drinkOptions} />
      ))}
    </div>
  );
}

function OfficeCard({ office, drinkOptions }: { office: Office; drinkOptions: DrinkOptions }) {
  const initial = office.preference?.defaultDrink;
  const [spec, setSpec] = useState<DrinkSpec | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!office.preference || !spec) {
    return (
      <Card className="flex flex-col gap-1 p-5">
        <SectionLabel>Office coffee · {office.company ?? "Company"}</SectionLabel>
        <p className="text-sm text-muted">
          Your company hasn&apos;t set up office coffee yet.
        </p>
      </Card>
    );
  }

  const drinks = ensureOption(drinkOptions.drinks, spec.drink);
  const sizes = ensureOption(drinkOptions.sizes, spec.size);
  const milks = ensureOption(drinkOptions.milks, spec.milk);
  const strengths = ensureOption(drinkOptions.strengths, spec.strength);

  async function save() {
    if (!spec) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/corporate/office-preference", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId: office.membershipId, drink: spec }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not save");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const locationSuffix = office.locationLabel ? ` · ${office.locationLabel}` : "";

  // Read-only view when the company doesn't allow members to self-select.
  if (!office.canSelfSelect) {
    return (
      <Card className="flex flex-col gap-2 p-5">
        <SectionLabel>Office coffee · {office.company ?? "Company"}</SectionLabel>
        <p className="font-display text-lg text-espresso">{spec.drink}</p>
        <p className="text-sm text-coffee">
          {spec.size} · {spec.milk} · {spec.sugar === 0 ? "no sugar" : `sugar ${spec.sugar}`} ·{" "}
          {spec.strength}
        </p>
        <p className="text-sm text-muted">
          Set by your company · {scheduleLabel(office.preference.schedule)}
          {locationSuffix}
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionLabel>Your office coffee · {office.company ?? "Company"}</SectionLabel>

      <fieldset className="flex flex-col gap-2">
        <span className="text-xs font-medium text-coffee">Drink</span>
        <div className="flex flex-wrap gap-2">
          {drinks.map((o) => (
            <Chip key={o.value} selected={spec.drink === o.value} onClick={() => setSpec({ ...spec, drink: o.value })}>
              {o.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <span className="text-xs font-medium text-coffee">Size</span>
        <div className="flex flex-wrap gap-2">
          {sizes.map((o) => (
            <Chip key={o.value} selected={spec.size === o.value} onClick={() => setSpec({ ...spec, size: o.value })}>
              {o.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <span className="text-xs font-medium text-coffee">Milk</span>
        <div className="flex flex-wrap gap-2">
          {milks.map((o) => (
            <Chip key={o.value} selected={spec.milk === o.value} onClick={() => setSpec({ ...spec, milk: o.value })}>
              {o.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <span className="text-xs font-medium text-coffee">Sugar</span>
        <div className="flex flex-wrap gap-2">
          {SUGAR_LEVELS.map((level) => (
            <Chip key={level} selected={spec.sugar === level} onClick={() => setSpec({ ...spec, sugar: level })}>
              {level === 0 ? "None" : level}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <span className="text-xs font-medium text-coffee">Strength</span>
        <div className="flex flex-wrap gap-2">
          {strengths.map((o) => (
            <Chip
              key={o.value}
              selected={spec.strength === o.value}
              onClick={() => setSpec({ ...spec, strength: o.value })}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <p className="text-sm text-muted">
        Set by your company · {scheduleLabel(office.preference.schedule)}
        {locationSuffix}
      </p>

      <Notice>
        Edit any day until the <span className="font-mono font-semibold">6:00 AM</span> cutoff.
      </Notice>

      {error && <p className="text-sm text-terracotta">{error}</p>}
      {saved && <p className="text-sm text-sage">Saved.</p>}
      <Button onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save office coffee"}
      </Button>
    </Card>
  );
}
