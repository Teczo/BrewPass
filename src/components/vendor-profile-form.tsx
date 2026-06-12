"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OperatingHoursField, type HoursWindow } from "@/components/operating-hours-field";
import type { VendorJson } from "@/lib/serializers";

const STATUS_OPTIONS = [
  { value: "active", label: "Open — accepting daily orders" },
  { value: "paused", label: "Paused — temporarily not taking new orders" },
  { value: "offline", label: "Offline — closed until further notice" },
] as const;

export function VendorProfileForm({ vendor }: { vendor: VendorJson }) {
  const router = useRouter();
  const [businessName, setBusinessName] = useState(vendor.businessName);
  const [address, setAddress] = useState(vendor.address);
  const [radiusKm, setRadiusKm] = useState(vendor.serviceAreaRadiusKm ?? 5);
  const [hours, setHours] = useState<HoursWindow[]>(vendor.operatingHours ?? []);
  const [status, setStatus] = useState(vendor.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hoursValid = hours.every((win) => win.open < win.close);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/vendor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          // Only send the address when edited — it triggers re-geocoding.
          ...(address !== vendor.address ? { address } : {}),
          serviceAreaRadiusKm: radiusKm,
          // Migrated vendors may have no hours yet (always open); hours
          // can be set but not unset from here.
          ...(hours.length > 0 ? { operatingHours: hours } : {}),
          status,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Update failed");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-700">Saved.</p>}

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs font-medium">Status</legend>
        {STATUS_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="status"
              value={option.value}
              checked={status === option.value}
              onChange={() => setStatus(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Business name
        <input
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          maxLength={120}
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Address
        <input
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={500}
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Delivery radius (km)
        <input
          type="number"
          min={1}
          max={100}
          className="w-32 rounded border border-neutral-300 px-2 py-1.5 text-sm"
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          required
        />
      </label>

      <OperatingHoursField value={hours} onChange={setHours} />
      {hours.length === 0 && (
        <p className="text-xs text-neutral-400">
          No hours set — you&apos;re treated as always open. Tick days to set hours.
        </p>
      )}

      <p className="text-xs text-neutral-400">
        Capacity: {vendor.capacityPerHour} orders/hour — contact the BrewPass team to change it.
      </p>

      <button
        type="submit"
        disabled={busy || !hoursValid}
        className="self-start rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
