"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";
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

// Compact figures row: rating · distance · price.
function VendorMeta({ card }: { card: VendorCard }) {
  return (
    <span className="font-mono text-xs text-muted">
      {card.ratingScore !== null && `★ ${card.ratingScore}`}
      {card.ratingScore !== null && " · "}
      {card.distanceKm} km
      {card.priceSen !== null && ` · ${formatMyr(card.priceSen)}`}
    </span>
  );
}

function VendorRow({
  card,
  drinkName,
  onSelect,
  busy,
  highlighted,
}: {
  card: VendorCard;
  drinkName: string;
  onSelect: () => void;
  busy: boolean;
  highlighted?: boolean;
}) {
  return (
    <Card
      className={cn(
        "flex items-center justify-between gap-3 p-4",
        highlighted && "border-[1.5px] border-sage",
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-espresso">{card.name}</span>
          {highlighted && <StatusPill tone="active">Preferred</StatusPill>}
          {!card.coversDrink && (
            <StatusPill tone="skipped">doesn&apos;t make {drinkName}</StatusPill>
          )}
        </div>
        <VendorMeta card={card} />
      </div>
      <Button variant="secondary" disabled={busy} onClick={onSelect}>
        Select
      </Button>
    </Card>
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
      {error && <p className="text-sm text-terracotta">{error}</p>}

      {/* Current confirmed selection */}
      <Card className="p-4">
        {preferredVendorId ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <StatusPill tone="active">Preferred</StatusPill>
              <p className="text-sm text-coffee">
                <span className="font-semibold text-espresso">
                  {preferredVendorName ?? "selected vendor"}
                </span>{" "}
                <span className="text-muted">({method === "ai" ? "AI pick" : "manual"})</span>
              </p>
            </div>
            <Button variant="secondary" disabled={busy} onClick={clearSelection} className="shrink-0">
              Auto-route
            </Button>
          </div>
        ) : (
          <p className="text-sm text-coffee">
            The platform auto-routes each order to the best available vendor. Pick a preferred
            vendor below to change that.
          </p>
        )}
      </Card>

      {/* Pending review — confirm step (rule #7) */}
      {pending && pendingCard && (
        <Card className="flex flex-col gap-3 border-[1.5px] border-sage p-4">
          <SectionLabel>Review your selection</SectionLabel>
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-espresso">{pendingCard.name}</span>
            <VendorMeta card={pendingCard} />
          </div>
          {pending.rationale && (
            <p className="rounded-[14px] bg-sage-soft px-4 py-3 text-sm text-sage-ink">
              💡 {pending.rationale}
            </p>
          )}
          <div className="flex gap-3">
            <Button disabled={busy} onClick={confirm}>
              {busy ? "Confirming…" : `Confirm ${pendingCard.name}`}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Mode switch */}
      <div className="flex gap-2 rounded-full bg-surface p-1 shadow-card">
        {(
          [
            { value: "ai", label: "Let AI pick" },
            { value: "manual", label: "Browse cafés" },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setMode(option.value)}
            className={cn(
              "flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              mode === option.value ? "bg-espresso text-white" : "text-coffee",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {vendors.length === 0 ? (
        <Card className="border border-dashed border-border p-4 text-sm text-muted">
          No vendors serve your area yet.
        </Card>
      ) : mode === "manual" ? (
        <ul className="flex flex-col gap-3">
          {vendors.map((card) => (
            <li key={card.id}>
              <VendorRow
                card={card}
                drinkName={drinkName}
                busy={busy}
                highlighted={card.id === preferredVendorId}
                onSelect={() => setPending({ vendorId: card.id, method: "manual" })}
              />
            </li>
          ))}
        </ul>
      ) : (
        <Card className="flex flex-col gap-3 p-5">
          <SectionLabel>What matters to you?</SectionLabel>
          {PRIORITIES.map((priority) => (
            <label
              key={priority.key}
              className="flex items-center justify-between gap-3 text-sm text-coffee"
            >
              <span>{priority.label}</span>
              <select
                className="rounded-xl border border-border bg-field px-3 py-2 text-sm font-medium text-ink focus:border-coffee focus:outline-none"
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
          <Button disabled={busy} onClick={getRecommendation} className="self-start">
            {busy ? "Thinking…" : "Recommend a vendor"}
          </Button>
        </Card>
      )}
    </div>
  );
}
