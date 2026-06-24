"use client";

import { useState } from "react";

/**
 * Starts a Stripe SetupIntent checkout to save (or replace) the card on file.
 * No charge happens here — coffee is charged per-day at cutoff. Used in the
 * onboarding payment step and on the billing page.
 */
export function SaveCardButton({
  returnTo,
  label = "Save my card",
  className,
}: {
  returnTo: "onboarding" | "billing";
  label?: string;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not start checkout");
      window.location.assign(body.url as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={
          className ??
          "rounded-md bg-amber-800 px-4 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        }
      >
        {busy ? "Redirecting…" : label}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
