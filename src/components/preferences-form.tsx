"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { LocationJson, PreferenceJson } from "@/lib/serializers";

const DRINK_SUGGESTIONS = [
  "Flat White",
  "Latte",
  "Cappuccino",
  "Americano",
  "Long Black",
  "Mocha",
  "Espresso",
  "Cold Brew",
];
const SIZES = ["small", "regular", "large"] as const;
const MILKS = ["Fresh milk", "Oat", "Almond", "Soy", "None"];
const STRENGTHS = ["mild", "regular", "strong", "double"] as const;
const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export interface PreferencesFormProps {
  locations: LocationJson[];
  initial: PreferenceJson | null;
  nextHref: string;
}

export function PreferencesForm({ locations, initial, nextHref }: PreferencesFormProps) {
  const router = useRouter();
  const [drink, setDrink] = useState(initial?.defaultDrink.drink ?? "Flat White");
  const [size, setSize] = useState<string>(initial?.defaultDrink.size ?? "regular");
  const [milk, setMilk] = useState(initial?.defaultDrink.milk ?? "Fresh milk");
  const [sugar, setSugar] = useState(initial?.defaultDrink.sugar ?? 0);
  const [strength, setStrength] = useState<string>(initial?.defaultDrink.strength ?? "regular");
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Your usual drink
        <input
          className="rounded-md border border-neutral-300 px-3 py-2"
          list="drink-suggestions"
          value={drink}
          onChange={(e) => setDrink(e.target.value)}
          required
        />
        <datalist id="drink-suggestions">
          {DRINK_SUGGESTIONS.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Size
          <select
            className="rounded-md border border-neutral-300 px-3 py-2"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          >
            {SIZES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Milk
          <select
            className="rounded-md border border-neutral-300 px-3 py-2"
            value={milk}
            onChange={(e) => setMilk(e.target.value)}
          >
            {MILKS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Sugar
          <select
            className="rounded-md border border-neutral-300 px-3 py-2"
            value={sugar}
            onChange={(e) => setSugar(Number(e.target.value))}
          >
            {[0, 1, 2, 3, 4, 5].map((level) => (
              <option key={level} value={level}>
                {level === 0 ? "No sugar" : `${level}`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Strength
          <select
            className="rounded-md border border-neutral-300 px-3 py-2"
            value={strength}
            onChange={(e) => setStrength(e.target.value)}
          >
            {STRENGTHS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flex flex-col gap-2 text-sm font-medium">
        <legend className="mb-1">Delivery days</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((weekday) => (
            <label
              key={weekday.value}
              className={`cursor-pointer rounded-md border px-3 py-2 ${
                days.includes(weekday.value)
                  ? "border-amber-800 bg-amber-50 text-amber-900"
                  : "border-neutral-300"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={days.includes(weekday.value)}
                onChange={() => toggleDay(weekday.value)}
              />
              {weekday.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Delivery time
          <input
            type="time"
            className="rounded-md border border-neutral-300 px-3 py-2"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Deliver to
          <select
            className="rounded-md border border-neutral-300 px-3 py-2"
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
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving || days.length === 0}
        className="rounded-md bg-amber-800 px-4 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Finish setup"}
      </button>
    </form>
  );
}
