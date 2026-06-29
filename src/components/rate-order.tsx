"use client";

import { useState } from "react";

/**
 * Post-delivery star rating for a delivered order (Phase G). Submits once;
 * on success it collapses to a thank-you. Used on the dashboard's recent
 * orders list for delivered, not-yet-rated orders.
 */
export function RateOrder({ orderId, initialScore }: { orderId: string; initialScore?: number }) {
  const [score, setScore] = useState<number | null>(initialScore ?? null);
  const [hover, setHover] = useState(0);
  const [done, setDone] = useState(initialScore != null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value: number) {
    setScore(value);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: value }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not submit rating");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setScore(null);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <span className="text-xs text-muted">
        Rated {score}
        <span className="text-amber-500">★</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          key={value}
          type="button"
          disabled={busy}
          aria-label={`Rate ${value} star${value === 1 ? "" : "s"}`}
          onMouseEnter={() => setHover(value)}
          onMouseLeave={() => setHover(0)}
          onClick={() => submit(value)}
          className={`text-lg leading-none disabled:opacity-50 ${
            value <= (hover || score || 0) ? "text-amber-500" : "text-hairline"
          }`}
        >
          ★
        </button>
      ))}
      {error && <span className="ml-1 text-xs text-terracotta">{error}</span>}
    </span>
  );
}
