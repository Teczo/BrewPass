"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { formatMyr } from "@/lib/format";
import type { VendorCard } from "@/lib/vendor-selection";

const PRIORITIES: Array<{ key: string; label: string }> = [
  { key: "proximity", label: "Close to me" },
  { key: "price", label: "Low price" },
  { key: "speed", label: "Fast delivery" },
  { key: "rating", label: "Highly rated" },
  { key: "drink", label: "Great at my drink" },
];
const PRIORITY_LEVELS = ["Doesn't matter", "Nice to have", "Important", "Top priority"];

interface Pending {
  vendorId: string;
  method: "manual" | "ai";
  rationale?: string;
}

function VendorLine({ card, drinkName }: { card: VendorCard; drinkName: string }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium">
        {card.name}
        {!card.coversDrink && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">
            doesn&apos;t make {drinkName}
          </span>
        )}
      </span>
      <span className="text-xs text-neutral-500">
        {card.distanceKm} km
        {card.ratingScore !== null && ` · ${card.ratingScore}★`}
        {card.priceSen !== null && ` · ${formatMyr(card.priceSen)}`}
      </span>
    </span>
  );
}

export function VendorSelector({
  vendors,
  drinkName,
  preferredVendorId,
  preferredVendorName,
  method,
}: {
  vendors: VendorCard[];
  drinkName: string;
  preferredVendorId: string | null;
  preferredVendorName: string | null;
  method: "manual" | "ai" | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"manual" | "ai">("manual");
  const [pending, setPending] = useState<Pending | null>(null);
  const [priorities, setPriorities] = useState<Record<string, number>>({
    proximity: 2,
    price: 1,
    speed: 1,
    rating: 1,
    drink: 1,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vendorById = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.id, vendor])),
    [vendors],
  );
  const pendingCard = pending ? vendorById.get(pending.vendorId) : null;

  async function send(url: string, method: string, body: unknown) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? "Request failed");
    return payload;
  }

  async function getRecommendation() {
    setBusy(true);
    setError(null);
    try {
      const payload = await send("/api/vendors/recommend", "POST", { priorities });
      if (!payload.recommendation) {
        setError("No vendors can serve you right now.");
        setPending(null);
      } else {
        setPending({
          vendorId: payload.recommendation.vendorId,
          method: "ai",
          rationale: payload.recommendation.rationale,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await send("/api/preferences/vendor", "PUT", {
        vendorId: pending.vendorId,
        method: pending.method,
      });
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function clearSelection() {
    setBusy(true);
    setError(null);
    try {
      await send("/api/preferences/vendor", "PUT", { vendorId: null });
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Current confirmed selection */}
      <section className="rounded-md border border-neutral-200 p-4">
        {preferredVendorId ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">
              Your preferred vendor:{" "}
              <span className="font-medium">{preferredVendorName ?? "selected vendor"}</span>{" "}
              <span className="text-neutral-400">({method === "ai" ? "AI pick" : "manual"})</span>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={clearSelection}
              className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
            >
              Use platform auto-route
            </button>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            The platform auto-routes each order to the best available vendor. Pick a preferred
            vendor below to change that.
          </p>
        )}
      </section>

      {/* Pending review — confirm step (rule #5) */}
      {pending && pendingCard && (
        <section className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Review your selection</p>
          <VendorLine card={pendingCard} drinkName={drinkName} />
          {pending.rationale && <p className="text-sm text-amber-900">💡 {pending.rationale}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={confirm}
              className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? "Confirming…" : "Confirm vendor"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending(null)}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Mode switch */}
      <div className="flex gap-2">
        {(["manual", "ai"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              mode === value
                ? "bg-neutral-900 text-white"
                : "border border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {value === "manual" ? "Browse vendors" : "Ask the assistant"}
          </button>
        ))}
      </div>

      {vendors.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
          No vendors serve your area yet.
        </p>
      ) : mode === "manual" ? (
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
          {vendors.map((card) => (
            <li key={card.id} className="flex items-center justify-between gap-3 p-3">
              <VendorLine card={card} drinkName={drinkName} />
              <button
                type="button"
                disabled={busy}
                onClick={() => setPending({ vendorId: card.id, method: "manual" })}
                className="shrink-0 rounded border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50"
              >
                Select
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
          <p className="text-sm text-neutral-500">How much does each of these matter to you?</p>
          {PRIORITIES.map((priority) => (
            <label key={priority.key} className="flex items-center justify-between gap-3 text-sm">
              <span>{priority.label}</span>
              <select
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
                value={priorities[priority.key]}
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
          <button
            type="button"
            disabled={busy}
            onClick={getRecommendation}
            className="self-start rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? "Thinking…" : "Recommend a vendor"}
          </button>
        </section>
      )}
    </div>
  );
}
