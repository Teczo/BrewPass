"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
import { formatMyr } from "@/lib/format";
import type { MonthlyListJson } from "@/lib/serializers";
import type { Option } from "@/lib/taxonomy-options";
import type { VendorCard } from "@/lib/vendor-selection";

const WEEKDAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PRIORITIES = [
  { key: "proximity", label: "Close to me" },
  { key: "price", label: "Low price" },
  { key: "speed", label: "Fast delivery" },
  { key: "rating", label: "Highly rated" },
  { key: "drink", label: "Great at my coffee" },
] as const;
const PRIORITY_LEVELS = ["Doesn't matter", "Nice to have", "Important", "Top priority"];
type Priorities = Record<(typeof PRIORITIES)[number]["key"], number>;
const DEFAULT_PRIORITIES: Priorities = { proximity: 2, price: 1, speed: 1, rating: 1, drink: 1 };

const SELECT_CLASS =
  "rounded-xl border border-border bg-field px-3 py-2 text-sm font-medium text-ink focus:border-coffee focus:outline-none disabled:opacity-50";

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
  const [priorities, setPriorities] = useState<Priorities>(DEFAULT_PRIORITIES);
  // Whether the questionnaire panel is open (always open when there's no list).
  const [planning, setPlanning] = useState(false);

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

  async function generateWithAi() {
    const next = await call("/api/monthly-list", "POST", { period, priorities });
    if (next) {
      setList(next);
      setPlanning(false);
    }
  }

  async function generateUsual() {
    const next = await call("/api/monthly-list", "POST", { period });
    if (next) {
      setList(next);
      setPlanning(false);
    }
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

  const questionnaire = (
    <Card className="flex flex-col gap-4 p-6">
      <p className="text-sm text-coffee">
        Answer a few questions and the assistant plans a coffee <em>and</em> a vendor for every
        delivery day in <span className="font-semibold text-espresso">{monthLabel(period)}</span> —
        varying the coffee so it stays interesting. You review the whole month, tweak any day, then
        confirm once.
      </p>

      <div className="flex flex-col gap-3">
        <SectionLabel>What matters most to you?</SectionLabel>
        {PRIORITIES.map((priority) => (
          <label
            key={priority.key}
            className="flex items-center justify-between gap-3 text-sm text-coffee"
          >
            <span>{priority.label}</span>
            <select
              className={SELECT_CLASS}
              value={priorities[priority.key]}
              disabled={busy}
              onChange={(e) =>
                setPriorities((prev) => ({ ...prev, [priority.key]: Number(e.target.value) }))
              }
            >
              {PRIORITY_LEVELS.map((label, level) => (
                <option key={level} value={level}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {error && <p className="text-sm text-terracotta">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={generateWithAi}>
          {busy ? "Planning…" : "Plan my month with AI"}
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={generateUsual}
          className="text-sm font-semibold text-coffee hover:underline disabled:opacity-50"
        >
          Just use my usual every day
        </button>
        {list && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setPlanning(false)}
            className="text-sm text-muted hover:underline disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </Card>
  );

  if (!list) return questionnaire;

  const confirmed = list.status === "confirmed";
  const plannedDays = list.entries.filter((entry) => !entry.skipped && entry.vendorId).length;
  const totalSen = list.entries.reduce(
    (sum, entry) => (!entry.skipped && entry.priceSen !== null ? sum + entry.priceSen : sum),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      {error && !planning && <p className="text-sm text-terracotta">{error}</p>}

      {planning && !confirmed && questionnaire}

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <StatusPill tone={confirmed ? "delivered" : "scheduled"}>
            {confirmed ? "Confirmed" : "Proposed"}
          </StatusPill>
          <p className="text-sm text-coffee">
            {plannedDays} coffee{plannedDays === 1 ? "" : "s"} · delivered at {list.time}
          </p>
        </div>
        {!confirmed && !planning && (
          <Button variant="outline" disabled={busy} onClick={() => setPlanning(true)}>
            Re-plan
          </Button>
        )}
      </div>

      {confirmed && (
        <Notice tone="sage" icon="✓">
          Your month is set. Each day&apos;s order is scheduled — change or skip an individual day
          from the dashboard up to its 6:00 AM cutoff.
        </Notice>
      )}

      <SectionLabel>
        {monthLabel(period)} · {plannedDays} delivery days
      </SectionLabel>

      <ul className="flex flex-col gap-3">
        {list.entries.map((entry) => (
          <Card
            as="li"
            key={entry.date}
            className={cn("flex flex-col gap-2 p-4", entry.skipped && "opacity-60")}
          >
            <div className="flex items-start gap-3">
              <div className="flex w-10 shrink-0 flex-col items-center">
                <span className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  {WEEKDAY_LABELS[entry.weekday]}
                </span>
                <span className="font-mono text-lg text-espresso">{entry.date.slice(8)}</span>
              </div>

              {confirmed ? (
                <div className="flex flex-1 items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-espresso">
                      {entry.skipped ? "Skipped" : entry.drink.drink}
                    </span>
                    {!entry.skipped && (
                      <span className="text-sm text-coffee">
                        {entry.vendorName ?? "auto-routed on the day"}
                        {entry.priceSen !== null && ` · ${formatMyr(entry.priceSen)}`}
                      </span>
                    )}
                  </div>
                  {entry.skipped && <StatusPill tone="skipped">Skipped</StatusPill>}
                </div>
              ) : (
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Drink for ${entry.date}`}
                      className={SELECT_CLASS}
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
                    {entry.priceSen !== null && !entry.skipped && (
                      <span className="font-mono text-sm text-coffee">
                        {formatMyr(entry.priceSen)}
                      </span>
                    )}
                  </div>

                  <select
                    aria-label={`Vendor for ${entry.date}`}
                    className={cn(SELECT_CLASS, "w-full")}
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
                      <option value={entry.vendorId}>
                        {entry.vendorName ?? "Assigned vendor"}
                      </option>
                    )}
                  </select>

                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={entry.skipped}
                      disabled={busy}
                      onChange={(e) => editDay(entry.date, { skipped: e.target.checked })}
                    />
                    Skip this day
                  </label>
                </div>
              )}
            </div>

            {entry.rationale && !entry.skipped && (
              <p className="pl-[52px] text-xs text-muted italic">{entry.rationale}</p>
            )}
          </Card>
        ))}
      </ul>

      {!confirmed && (
        <Card className="flex items-center justify-between gap-3 p-4">
          <div className="flex flex-col">
            <span className="font-semibold text-espresso">
              {plannedDays} coffee{plannedDays === 1 ? "" : "s"} this month
            </span>
            {totalSen > 0 && (
              <span className="font-mono text-sm text-coffee">≈ {formatMyr(totalSen)}</span>
            )}
          </div>
          <Button disabled={busy || plannedDays === 0} onClick={confirm}>
            {busy ? "Confirming…" : "Confirm month"}
          </Button>
        </Card>
      )}
    </div>
  );
}
