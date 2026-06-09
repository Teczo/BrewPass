"use client";

import Link from "next/link";
import { useState } from "react";

import type { LocationJson } from "@/lib/serializers";

const LABEL_PRESETS = ["Home", "Office"] as const;

export interface LocationsManagerProps {
  initial: LocationJson[];
  nextHref: string;
}

export function LocationsManager({ initial, nextHref }: LocationsManagerProps) {
  const [locations, setLocations] = useState(initial);
  const [label, setLabel] = useState<string>("Home");
  const [customLabel, setCustomLabel] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const effectiveLabel = label === "Other" ? customLabel : label;

  async function addLocation(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: effectiveLabel,
          address,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to add location");
      setLocations((prev) => [...prev, body.location as LocationJson]);
      setAddress("");
      setNotes("");
      setCustomLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function removeLocation(id: string) {
    setError(null);
    const response = await fetch(`/api/locations/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Failed to delete location");
      return;
    }
    setLocations((prev) => prev.filter((location) => location.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      {locations.length > 0 && (
        <ul className="flex flex-col gap-2">
          {locations.map((location) => (
            <li
              key={location.id}
              className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 p-3"
            >
              <div>
                <p className="font-medium">{location.label}</p>
                <p className="text-sm text-neutral-500">{location.address}</p>
                {location.notes && <p className="text-sm text-neutral-400">{location.notes}</p>}
              </div>
              <button
                type="button"
                onClick={() => removeLocation(location.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={addLocation}
        className="flex flex-col gap-4 rounded-md border border-neutral-200 p-4"
      >
        <p className="font-medium">Add a delivery location</p>
        <div className="flex gap-2">
          {[...LABEL_PRESETS, "Other"].map((preset) => (
            <label
              key={preset}
              className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                label === preset
                  ? "border-amber-800 bg-amber-50 text-amber-900"
                  : "border-neutral-300"
              }`}
            >
              <input
                type="radio"
                name="label"
                className="sr-only"
                value={preset}
                checked={label === preset}
                onChange={() => setLabel(preset)}
              />
              {preset}
            </label>
          ))}
        </div>
        {label === "Other" && (
          <input
            className="rounded-md border border-neutral-300 px-3 py-2"
            placeholder="Label (e.g. Gym)"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            required
            maxLength={60}
          />
        )}
        <textarea
          className="rounded-md border border-neutral-300 px-3 py-2"
          placeholder="Full address — we'll pin it on the map"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          required
          rows={2}
        />
        <input
          className="rounded-md border border-neutral-300 px-3 py-2"
          placeholder="Delivery notes (optional, e.g. 'Level 12, ask for Aiman')"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={saving || (label === "Other" && !customLabel.trim())}
          className="rounded-md border border-amber-800 px-4 py-2 font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add location"}
        </button>
      </form>

      <Link
        href={nextHref}
        aria-disabled={locations.length === 0}
        className={`rounded-md px-4 py-2 text-center font-medium text-white ${
          locations.length === 0
            ? "pointer-events-none bg-neutral-300"
            : "bg-amber-800 hover:bg-amber-700"
        }`}
      >
        Continue
      </Link>
    </div>
  );
}
