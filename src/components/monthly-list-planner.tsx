"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatMyr } from "@/lib/format";
import type { MonthlyListJson } from "@/lib/serializers";
import type { Option } from "@/lib/taxonomy-options";
import type { VendorCard } from "@/lib/vendor-selection";

const WEEKDAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface Props {
  period: string;
  initialList: MonthlyListJson | null;
  vendors: VendorCard[];
  drinkOptions: Option[];
}

export function MonthlyListPlanner({ period, initialList, vendors, drinkOptions }: Props) {
  const router = useRouter();
  const [list, setList] = useState<MonthlyListJson | null>(initialList);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<MonthlyListJson | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Request failed");
      return payload.list as MonthlyListJson;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    const next = await call("/api/monthly-list", "POST", { period });
    if (next) setList(next);
  }

  async function editDay(date: string, edit: Record<string, unknown>) {
    const next = await call("/api/monthly-list", "PATCH", {
      period,
      edits: [{ date, ...edit }],
    });
    if (next) setList(next);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/monthly-list/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Request failed");
      setList(payload.list as MonthlyListJson);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!list) {
    return (
      <div className="flex flex-col gap-4 rounded-md border border-neutral-200 p-6">
        <p className="text-sm text-neutral-600">
          Let the assistant plan a coffee and a vendor for every delivery day in{" "}
          <span className="font-medium">{monthLabel(period)}</span>. You review the whole month,
          tweak any day, then confirm once — no daily fiddling.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={generate}
          className="self-start rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? "Planning…" : "Build my month"}
        </button>
      </div>
    );
  }

  const confirmed = list.status === "confirmed";
  const plannedDays = list.entries.filter((entry) => !entry.skipped && entry.vendorId).length;

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{monthLabel(period)}</h2>
          <p className="text-sm text-neutral-500">
            {confirmed ? "Confirmed · " : "Proposed · "}
            {plannedDays} coffee{plannedDays === 1 ? "" : "s"} planned · delivered at {list.time}
          </p>
        </div>
        {confirmed ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
            Confirmed
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={generate}
            className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            Re-plan
          </button>
        )}
      </div>

      {confirmed && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          Your month is set. Each day&apos;s order is scheduled — change or skip an individual day
          from the dashboard up to its 6:00 AM cutoff.
        </p>
      )}

      <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
        {list.entries.map((entry) => (
          <li
            key={entry.date}
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm ${
              entry.skipped ? "bg-neutral-50 text-neutral-400" : ""
            }`}
          >
            <span className="w-28 shrink-0 font-medium text-neutral-900">
              {WEEKDAY_LABELS[entry.weekday]} {entry.date.slice(8)}
            </span>

            {confirmed ? (
              <>
                <span className="flex-1">{entry.skipped ? "Skipped" : entry.drink.drink}</span>
                <span className="text-neutral-500">
                  {entry.skipped ? "" : (entry.vendorName ?? "auto-routed on the day")}
                </span>
              </>
            ) : (
              <>
                <select
                  aria-label={`Drink for ${entry.date}`}
                  className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                  value={entry.drink.drink}
                  disabled={busy || entry.skipped}
                  onChange={(e) =>
                    editDay(entry.date, { drink: { ...entry.drink, drink: e.target.value } })
                  }
                >
                  {drinkOptions.some((o) => o.value === entry.drink.drink) ? null : (
                    <option value={entry.drink.drink}>{entry.drink.drink}</option>
                  )}
                  {drinkOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  aria-label={`Vendor for ${entry.date}`}
                  className="flex-1 rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                  value={entry.vendorId ?? ""}
                  disabled={busy || entry.skipped}
                  onChange={(e) => editDay(entry.date, { vendorId: e.target.value || null })}
                >
                  <option value="">Auto-route on the day</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                      {!vendor.coversDrink ? " (can't make it)" : ""}
                    </option>
                  ))}
                  {/* Keep a currently-assigned vendor selectable even if it's
                      not in the area list (e.g. AI-routed). */}
                  {entry.vendorId && !vendors.some((v) => v.id === entry.vendorId) && (
                    <option value={entry.vendorId}>{entry.vendorName ?? "Assigned vendor"}</option>
                  )}
                </select>

                {entry.priceSen !== null && !entry.skipped && (
                  <span className="w-16 shrink-0 text-right text-neutral-500">
                    {formatMyr(entry.priceSen)}
                  </span>
                )}

                <label className="flex shrink-0 items-center gap-1 text-neutral-500">
                  <input
                    type="checkbox"
                    checked={entry.skipped}
                    disabled={busy}
                    onChange={(e) => editDay(entry.date, { skipped: e.target.checked })}
                  />
                  Skip
                </label>
              </>
            )}
          </li>
        ))}
      </ul>

      {!confirmed && (
        <button
          type="button"
          disabled={busy || plannedDays === 0}
          onClick={confirm}
          className="self-start rounded-md bg-amber-800 px-5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? "Confirming…" : `Confirm ${monthLabel(period)}`}
        </button>
      )}
    </div>
  );
}
