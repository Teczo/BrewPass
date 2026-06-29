"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
import type { LocationJson, OrderJson } from "@/lib/serializers";
import { DEFAULT_DRINK_OPTIONS, ensureOption, type DrinkOptions } from "@/lib/taxonomy-options";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  preparing: "Being prepared",
  out_for_delivery: "On its way",
  delivered: "Delivered",
  skipped: "Skipped",
  failed: "Failed",
};

const STATUS_TONES: Record<string, StatusTone> = {
  scheduled: "scheduled",
  confirmed: "scheduled",
  preparing: "preparing",
  out_for_delivery: "preparing",
  delivered: "delivered",
  skipped: "skipped",
  failed: "failed",
};

function formatKl(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

// Translucent attribute pill shown on the dark detail card.
function AttrPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/40 px-3 py-[5px] text-[11px] font-semibold text-white">
      {children}
    </span>
  );
}

const SELECT_CLASS =
  "rounded-xl border border-border bg-field px-3.5 py-3 text-[15px] font-medium text-ink focus:border-coffee focus:outline-none";

export interface AddOnOption {
  key: string;
  name: string;
  priceLabel: string;
}

export function UpcomingOrder({
  order,
  locations,
  addOnOptions = [],
  drinkOptions = DEFAULT_DRINK_OPTIONS,
}: {
  order: OrderJson;
  locations: LocationJson[];
  /** Empty when add-ons aren't available (e.g. corporate plans). */
  addOnOptions?: AddOnOption[];
  /** Canonical drink options from the platform taxonomy. */
  drinkOptions?: DrinkOptions;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [drink, setDrink] = useState(order.drink.drink);
  const [size, setSize] = useState<string>(order.drink.size);
  const [milk, setMilk] = useState(order.drink.milk);
  const [sugar, setSugar] = useState(order.drink.sugar);
  const [strength, setStrength] = useState<string>(order.drink.strength);

  // Keep the order's current values selectable even if the taxonomy changed.
  const drinks = ensureOption(drinkOptions.drinks, drink);
  const sizes = ensureOption(drinkOptions.sizes, size);
  const milks = ensureOption(drinkOptions.milks, milk);
  const strengths = ensureOption(drinkOptions.strengths, strength);
  const [locationId, setLocationId] = useState(order.location.locationId);
  const [addOnKeys, setAddOnKeys] = useState<string[]>(order.addOns.map((addOn) => addOn.key));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleAddOn(key: string) {
    setAddOnKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // Snapshot the clock once per mount; the server re-checks the real
  // cutoff on every request anyway.
  const [mountedAtMs] = useState(() => Date.now());
  const beforeCutoff = mountedAtMs < new Date(order.cutoffAt).getTime();
  const canModify = order.status === "scheduled" && beforeCutoff;
  const canUnskip = order.status === "skipped" && beforeCutoff;
  const locksIn = formatDuration(new Date(order.cutoffAt).getTime() - mountedAtMs);

  async function act(body: object) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Update failed");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Dark "Tomorrow's Coffee" detail card */}
      <div className="flex flex-col gap-4 rounded-3xl bg-espresso p-6 text-white shadow-card-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
              Tomorrow&apos;s Coffee
            </span>
            <span className="text-xs text-white/60">{order.date}</span>
          </div>
          <StatusPill tone={STATUS_TONES[order.status] ?? "scheduled"}>
            {STATUS_LABELS[order.status] ?? order.status}
          </StatusPill>
        </div>

        {order.status !== "skipped" ? (
          <>
            <h2 className="font-display text-3xl leading-tight">{order.drink.drink}</h2>
            <div className="flex flex-wrap gap-2">
              <AttrPill>{order.drink.size}</AttrPill>
              <AttrPill>{order.drink.milk}</AttrPill>
              <AttrPill>{order.drink.strength}</AttrPill>
              <AttrPill>
                {order.drink.sugar === 0 ? "No sugar" : `Sugar ${order.drink.sugar}`}
              </AttrPill>
            </div>
            {order.addOns.length > 0 && (
              <p className="text-sm text-amber">
                + {order.addOns.map((addOn) => addOn.name).join(", ")}
                {order.addOnsPaymentStatus === "failed" && (
                  <span className="ml-1 text-terracotta-soft">(payment failed — removed)</span>
                )}
              </p>
            )}
            <div className="border-t border-white/15 pt-3 text-sm text-white/80">
              <p>{order.location.label}</p>
              <p className="mt-0.5">
                Expected by {formatKl(order.deliverAt)}{" "}
                <span className="text-white/50">(Asia/Kuala_Lumpur)</span>
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-white/70">
            You&apos;re skipping this one — no coffee, no quota used.
          </p>
        )}
      </div>

      {canModify && (
        <Notice>
          Locks in <span className="font-mono font-semibold">{locksIn}</span>. You
          can edit or skip until {formatKl(order.cutoffAt)} daily.
        </Notice>
      )}

      {canModify && order.suggestion && (
        <Notice tone="sage" icon="💡">
          <div className="flex flex-col gap-2">
            <span>{order.suggestion.message}</span>
            {order.suggestion.drink && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  act({
                    action: "modify",
                    drink: { ...order.drink, drink: order.suggestion!.drink },
                  })
                }
                className="self-start"
              >
                Switch to {order.suggestion.drink}
              </Button>
            )}
          </div>
        </Notice>
      )}

      {canModify && !editing && (
        <div className="flex gap-3">
          <Button onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="secondary" onClick={() => act({ action: "skip" })} disabled={busy}>
            Skip Day
          </Button>
        </div>
      )}
      {canUnskip && (
        <Button
          className="self-start"
          onClick={() => act({ action: "unskip" })}
          disabled={busy}
        >
          Restore tomorrow&apos;s coffee
        </Button>
      )}

      {editing && (
        <form
          className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card"
          onSubmit={(event) => {
            event.preventDefault();
            act({
              action: "modify",
              drink: { drink, size, milk, sugar, strength },
              locationId,
              ...(addOnOptions.length > 0 ? { addOnKeys } : {}),
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-coffee">
              Drink
              <select
                className={SELECT_CLASS}
                value={drink}
                onChange={(e) => setDrink(e.target.value)}
                required
              >
                {drinks.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-coffee">
              Size
              <select
                className={SELECT_CLASS}
                value={size}
                onChange={(e) => setSize(e.target.value)}
              >
                {sizes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-coffee">
              Milk
              <select
                className={SELECT_CLASS}
                value={milk}
                onChange={(e) => setMilk(e.target.value)}
              >
                {milks.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-coffee">
              Strength
              <select
                className={SELECT_CLASS}
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
              >
                {strengths.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-coffee">
              Sugar
              <select
                className={SELECT_CLASS}
                value={sugar}
                onChange={(e) => setSugar(Number(e.target.value))}
              >
                {[0, 1, 2, 3, 4, 5].map((level) => (
                  <option key={level} value={level}>
                    {level === 0 ? "No sugar" : level}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-coffee">
              Deliver to
              <select
                className={SELECT_CLASS}
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {addOnOptions.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-medium text-coffee">
                Add-ons (charged to your card at 6:00 AM)
              </legend>
              <div className="flex flex-wrap gap-2">
                {addOnOptions.map((option) => (
                  <label
                    key={option.key}
                    className={cn(
                      "cursor-pointer rounded-full border px-4 py-[9px] text-[13px] font-semibold",
                      addOnKeys.includes(option.key)
                        ? "border-espresso bg-espresso text-white"
                        : "border-border bg-surface text-coffee",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={addOnKeys.includes(option.key)}
                      onChange={() => toggleAddOn(option.key)}
                    />
                    {option.name} · {option.priceLabel}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-terracotta">{error}</p>}
    </section>
  );
}
