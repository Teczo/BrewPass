"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OperatingHoursField, type HoursWindow } from "@/components/operating-hours-field";

const WEEKDAY_HOURS: HoursWindow[] = [1, 2, 3, 4, 5].map((day) => ({
  day,
  open: "08:00",
  close: "18:00",
}));

export function VendorApplyForm() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [capacity, setCapacity] = useState(30);
  const [radiusKm, setRadiusKm] = useState(5);
  const [hours, setHours] = useState<HoursWindow[]>(WEEKDAY_HOURS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hoursValid = hours.length > 0 && hours.every((win) => win.open < win.close);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/vendor/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          address,
          capacityPerHour: capacity,
          serviceAreaRadiusKm: radiusKm,
          operatingHours: hours,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Application failed");
      router.push("/vendor");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {error && <p className="text-sm text-red-600">{error}</p>}

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
          placeholder="Street, city — we'll locate you on the map"
          maxLength={500}
          required
        />
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Orders you can prepare per hour
          <input
            type="number"
            min={1}
            max={1000}
            className="w-32 rounded border border-neutral-300 px-2 py-1.5 text-sm"
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
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
      </div>

      <OperatingHoursField value={hours} onChange={setHours} />
      {hours.length === 0 && <p className="text-xs text-red-600">Select at least one open day.</p>}

      <button
        type="submit"
        disabled={busy || !hoursValid}
        className="self-start rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
