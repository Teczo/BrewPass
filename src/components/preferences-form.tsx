"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import type { LocationJson, PreferenceJson } from "@/lib/serializers";
import { DEFAULT_DRINK_OPTIONS, ensureOption, type DrinkOptions } from "@/lib/taxonomy-options";

const WEEKDAYS = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 7, label: "S" },
];

const SUGAR_LEVELS = [0, 1, 2, 3, 4, 5];

export interface PreferencesFormProps {
  locations: LocationJson[];
  initial: PreferenceJson | null;
  nextHref: string;
  /** Canonical options from the platform taxonomy; falls back to the
   * built-in defaults when the page doesn't supply them. */
  options?: DrinkOptions;
}

export function PreferencesForm({
  locations,
  initial,
  nextHref,
  options = DEFAULT_DRINK_OPTIONS,
}: PreferencesFormProps) {
  const router = useRouter();
  const [drink, setDrink] = useState(initial?.defaultDrink.drink ?? options.drinks[0]?.value ?? "");
  const [size, setSize] = useState<string>(initial?.defaultDrink.size ?? "regular");
  const [milk, setMilk] = useState(initial?.defaultDrink.milk ?? options.milks[0]?.value ?? "");
  const [sugar, setSugar] = useState(initial?.defaultDrink.sugar ?? 0);
  const [strength, setStrength] = useState<string>(initial?.defaultDrink.strength ?? "regular");

  // A saved preference may reference a value the active taxonomy no longer
  // lists; keep it selectable so editing never silently changes the drink.
  const drinks = ensureOption(options.drinks, drink);
  const sizes = ensureOption(options.sizes, size);
  const milks = ensureOption(options.milks, milk);
  const strengths = ensureOption(options.strengths, strength);
  const [days, setDays] = useState<number[]>(initial?.schedule.days ?? [1, 2, 3, 4, 5]);
  const [time, setTime] = useState(initial?.schedule.time ?? "08:00");
  const [locationId, setLocationId] = useState(
    initial?.defaultLocationId ?? locations[0]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleDay(day: number) {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultDrink: { drink, size, milk, sugar, strength },
          schedule: { days, time },
          defaultLocationId: locationId,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save preferences");
      }
      router.push(nextHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2.5">
        <SectionLabel>Drink</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {drinks.map((option) => (
            <Chip
              key={option.value}
              selected={drink === option.value}
              onClick={() => setDrink(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2.5">
        <SectionLabel>Size</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {sizes.map((option) => (
            <Chip
              key={option.value}
              selected={size === option.value}
              onClick={() => setSize(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2.5">
        <SectionLabel>Milk</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {milks.map((option) => (
            <Chip
              key={option.value}
              selected={milk === option.value}
              onClick={() => setMilk(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2.5">
        <SectionLabel>Strength</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {strengths.map((option) => (
            <Chip
              key={option.value}
              selected={strength === option.value}
              onClick={() => setStrength(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2.5">
        <SectionLabel>Sugar</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {SUGAR_LEVELS.map((level) => (
            <Chip
              key={level}
              selected={sugar === level}
              onClick={() => setSugar(level)}
            >
              {level === 0 ? "None" : level}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2.5">
        <SectionLabel>Schedule</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((weekday) => (
            <Chip
              key={weekday.value}
              selected={days.includes(weekday.value)}
              onClick={() => toggleDay(weekday.value)}
              className="w-11"
              aria-label={`Day ${weekday.value}`}
            >
              {weekday.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="time">Delivery time</Label>
        <Input
          id="time"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="deliver-to">Deliver to</Label>
        <select
          id="deliver-to"
          className="w-full rounded-xl border border-border bg-field px-3.5 py-3 text-[15px] font-medium text-ink focus:border-coffee focus:outline-none"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          required
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-terracotta">{error}</p>}
      <Button type="submit" disabled={saving || days.length === 0} fullWidth>
        {saving ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
