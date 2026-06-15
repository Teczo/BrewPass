"use client";

import { useState } from "react";

import type { VendorJson } from "@/lib/serializers";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function labelFor(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${date.slice(8)}/${date.slice(5, 7)}`;
}

export function VendorCapacity({ vendor, today }: { vendor: VendorJson; today: string }) {
  const [dailyCapacity, setDailyCapacity] = useState<string>(
    vendor.dailyCapacity?.toString() ?? "",
  );
  const [acceptCutoff, setAcceptCutoff] = useState<string>(vendor.orderAcceptCutoff ?? "");
  const [slots, setSlots] = useState(vendor.slotCapacities);
  const [soldOut, setSoldOut] = useState<string[]>(vendor.soldOutDates);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const nextDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  async function saveSettings() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        dailyCapacity: dailyCapacity.trim() === "" ? null : Number(dailyCapacity),
        orderAcceptCutoff: acceptCutoff.trim() === "" ? null : acceptCutoff,
        slotCapacities: slots,
      };
      const response = await fetch("/api/vendor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not save");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSoldOut(date: string, value: boolean) {
    const previous = soldOut;
    setSoldOut(value ? [...soldOut, date] : soldOut.filter((d) => d !== date));
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/vendor/sold-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, soldOut: value }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not update");
      setSoldOut(payload.soldOutDates);
    } catch (err) {
      setSoldOut(previous);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function setSlot(hour: number, cap: string) {
    const others = slots.filter((s) => s.hour !== hour);
    if (cap.trim() === "") {
      setSlots(others);
    } else {
      setSlots([...others, { hour, cap: Number(cap) }].sort((a, b) => a.hour - b.hour));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Sold out today */}
      <section className="rounded-md border border-neutral-200 p-4">
        <h2 className="font-semibold">Sold out</h2>
        <p className="text-sm text-neutral-500">
          Pause new orders for a day without changing your hours. Routing skips sold-out days.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {nextDays.map((date) => {
            const isSoldOut = soldOut.includes(date);
            return (
              <button
                key={date}
                type="button"
                disabled={busy}
                onClick={() => toggleSoldOut(date, !isSoldOut)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  isSoldOut
                    ? "bg-red-100 text-red-700"
                    : "border border-neutral-300 hover:bg-neutral-50"
                } disabled:opacity-50`}
              >
                {labelFor(date)}
                {date === today ? " · today" : ""}
                {isSoldOut ? " · sold out" : ""}
              </button>
            );
          })}
        </div>
      </section>

      {/* Daily cap + accept cutoff */}
      <section className="flex flex-col gap-4 rounded-md border border-neutral-200 p-4">
        <h2 className="font-semibold">Capacity &amp; cutoff</h2>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Daily order cap
            <span className="block text-xs text-neutral-500">Blank = unlimited.</span>
          </span>
          <input
            type="number"
            min={1}
            value={dailyCapacity}
            onChange={(e) => setDailyCapacity(e.target.value)}
            className="w-28 rounded border border-neutral-300 px-2 py-1"
            placeholder="unlimited"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Stop accepting at
            <span className="block text-xs text-neutral-500">
              Same-day cutoff for re-routed orders. Blank = none.
            </span>
          </span>
          <input
            type="time"
            value={acceptCutoff}
            onChange={(e) => setAcceptCutoff(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1"
          />
        </label>
      </section>

      {/* Per-hour slot caps */}
      <section className="rounded-md border border-neutral-200 p-4">
        <h2 className="font-semibold">Per-hour caps</h2>
        <p className="text-sm text-neutral-500">
          Optional limit on deliveries in a given hour. Blank = limited only by the daily cap.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 18 }, (_, i) => i + 6).map((hour) => {
            const slot = slots.find((s) => s.hour === hour);
            return (
              <label key={hour} className="flex items-center gap-2 text-sm">
                <span className="w-12 shrink-0 text-neutral-600 tabular-nums">
                  {hour.toString().padStart(2, "0")}:00
                </span>
                <input
                  type="number"
                  min={0}
                  value={slot ? slot.cap : ""}
                  onChange={(e) => setSlot(hour, e.target.value)}
                  className="w-16 rounded border border-neutral-300 px-2 py-1"
                  placeholder="—"
                />
              </label>
            );
          })}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={saveSettings}
          className="self-start rounded-md bg-amber-800 px-5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save capacity settings"}
        </button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
      </div>
    </div>
  );
}
