"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
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
  const [locating, setLocating] = useState(false);

  const effectiveLabel = label === "Other" ? customLabel : label;

  /** Native geolocation in the Capacitor shell, browser API on the web. */
  async function useCurrentLocation() {
    setLocating(true);
    setError(null);
    try {
      const { Capacitor } = await import("@capacitor/core");
      let lat: number;
      let lng: number;
      if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import("@capacitor/geolocation");
        const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
        lat = position.coords.latitude;
        lng = position.coords.longitude;
      } else {
        const position = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 }),
        );
        lat = position.coords.latitude;
        lng = position.coords.longitude;
      }
      const response = await fetch("/api/geocode/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not resolve your location");
      setAddress(body.address as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not get your location");
    } finally {
      setLocating(false);
    }
  }

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
      <button
        type="button"
        onClick={useCurrentLocation}
        disabled={locating}
        className={buttonClasses("secondary", "w-full disabled:opacity-50")}
      >
        {locating ? "Locating…" : "📍 Use my current location"}
      </button>

      {locations.length > 0 && (
        <ul className="flex flex-col gap-3">
          {locations.map((location, index) => (
            <Card
              as="li"
              key={location.id}
              className="flex items-start justify-between gap-3 p-4"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-espresso">{location.label}</p>
                  {index === 0 && <StatusPill tone="active">Default</StatusPill>}
                </div>
                <p className="text-sm text-coffee">{location.address}</p>
                {location.notes && <p className="text-sm text-muted">{location.notes}</p>}
              </div>
              <button
                type="button"
                onClick={() => removeLocation(location.id)}
                className="text-sm font-semibold text-terracotta hover:underline"
              >
                Remove
              </button>
            </Card>
          ))}
        </ul>
      )}

      <Card as="form" onSubmit={addLocation} className="flex flex-col gap-4 p-5">
        <p className="font-semibold text-espresso">Add another address</p>
        <div className="flex flex-wrap gap-2">
          {[...LABEL_PRESETS, "Other"].map((preset) => (
            <Chip
              key={preset}
              selected={label === preset}
              onClick={() => setLabel(preset)}
            >
              {preset}
            </Chip>
          ))}
        </div>
        {label === "Other" && (
          <Input
            placeholder="Label (e.g. Gym)"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            required
            maxLength={60}
          />
        )}
        <textarea
          className="w-full rounded-xl border border-border bg-field px-3.5 py-3 text-[15px] font-medium text-ink placeholder:text-muted focus:border-coffee focus:outline-none"
          placeholder="Full address — we'll pin it on the map"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          required
          rows={2}
        />
        <Input
          placeholder="Delivery notes (optional, e.g. 'Level 12, ask for Aiman')"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
        />
        {error && <p className="text-sm text-terracotta">{error}</p>}
        <Button
          type="submit"
          variant="secondary"
          disabled={saving || (label === "Other" && !customLabel.trim())}
        >
          {saving ? "Adding…" : "Add location"}
        </Button>
      </Card>

      <Link
        href={nextHref}
        aria-disabled={locations.length === 0}
        className={cn(
          buttonClasses("primary", "w-full"),
          locations.length === 0 && "pointer-events-none opacity-50",
        )}
      >
        Continue
      </Link>
    </div>
  );
}
