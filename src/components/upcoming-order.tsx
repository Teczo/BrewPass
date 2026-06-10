"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { LocationJson, OrderJson } from "@/lib/serializers";

const SIZES = ["small", "regular", "large"] as const;
const STRENGTHS = ["mild", "regular", "strong", "double"] as const;
const MILKS = ["Fresh milk", "Oat", "Almond", "Soy", "None"];

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  preparing: "Being prepared",
  out_for_delivery: "On its way",
  delivered: "Delivered",
  skipped: "Skipped",
  failed: "Failed",
};

function formatKl(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function UpcomingOrder({
  order,
  locations,
}: {
  order: OrderJson;
  locations: LocationJson[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [drink, setDrink] = useState(order.drink.drink);
  const [size, setSize] = useState<string>(order.drink.size);
  const [milk, setMilk] = useState(order.drink.milk);
  const [sugar, setSugar] = useState(order.drink.sugar);
  const [strength, setStrength] = useState<string>(order.drink.strength);
  const [locationId, setLocationId] = useState(order.location.locationId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Snapshot the clock once per mount; the server re-checks the real
  // cutoff on every request anyway.
  const [mountedAtMs] = useState(() => Date.now());
  const beforeCutoff = mountedAtMs < new Date(order.cutoffAt).getTime();
  const canModify = order.status === "scheduled" && beforeCutoff;
  const canUnskip = order.status === "skipped" && beforeCutoff;

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
    <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold">Tomorrow&apos;s coffee</h2>
          <p className="text-sm text-neutral-500">
            {order.date} · {STATUS_LABELS[order.status] ?? order.status}
          </p>
        </div>
        {canModify && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
            Locks at {formatKl(order.cutoffAt)}
          </span>
        )}
      </div>

      {order.status !== "skipped" ? (
        <div className="text-sm text-neutral-600">
          <p className="text-lg font-medium text-neutral-900">{order.drink.drink}</p>
          <p>
            {order.drink.size} · {order.drink.milk} ·{" "}
            {order.drink.sugar === 0 ? "no sugar" : `sugar ${order.drink.sugar}`} ·{" "}
            {order.drink.strength}
          </p>
          <p className="mt-1">
            To {order.location.label} at {formatKl(order.deliverAt)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">
          You&apos;re skipping this one — no coffee, no quota used.
        </p>
      )}

      {canModify && order.suggestion && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-amber-900">💡 {order.suggestion.message}</p>
          {order.suggestion.drink && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act({
                  action: "modify",
                  drink: { ...order.drink, drink: order.suggestion!.drink },
                })
              }
              className="shrink-0 rounded-md bg-amber-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Switch to {order.suggestion.drink}
            </button>
          )}
        </div>
      )}

      {canModify && !editing && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Change
          </button>
          <button
            type="button"
            onClick={() => act({ action: "skip" })}
            disabled={busy}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            Skip tomorrow
          </button>
        </div>
      )}
      {canUnskip && (
        <button
          type="button"
          onClick={() => act({ action: "unskip" })}
          disabled={busy}
          className="self-start rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Restore tomorrow&apos;s coffee
        </button>
      )}

      {editing && (
        <form
          className="flex flex-col gap-3 rounded-md bg-neutral-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            act({
              action: "modify",
              drink: { drink, size, milk, sugar, strength },
              locationId,
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Drink
              <input
                className="rounded-md border border-neutral-300 px-3 py-2"
                value={drink}
                onChange={(e) => setDrink(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Size
              <select
                className="rounded-md border border-neutral-300 px-3 py-2"
                value={size}
                onChange={(e) => setSize(e.target.value)}
              >
                {SIZES.map((option) => (
                  <option key={option}>{option}</option>
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
                  <option key={option}>{option}</option>
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
                  <option key={option}>{option}</option>
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
                    {level === 0 ? "No sugar" : level}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Deliver to
              <select
                className="rounded-md border border-neutral-300 px-3 py-2"
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
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
