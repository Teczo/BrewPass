"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface OverlapOfficeJson {
  orderId: string;
  membershipId: string | null;
  company: string;
  drink: string;
  canDecline: boolean;
}

export interface OverlapDayJson {
  date: string;
  editable: boolean;
  personal: { orderId: string; drink: string };
  offices: OverlapOfficeJson[];
}

/**
 * Phase J.5 — advisory same-day overlap notice. Non-blocking by design: the
 * member already has both coffees scheduled (billed to different cards, no
 * conflict) and the default is to keep both. This only offers a one-tap "cancel
 * one" and an optional "remember my choice" — it never forces a daily decision.
 */
export function OverlapNotice({ overlaps }: { overlaps: OverlapDayJson[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = overlaps.filter((o) => o.editable && !dismissed.has(o.date));
  if (visible.length === 0) return null;

  async function send(url: string, method: string, payload: object) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Action failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function cancel(date: string, side: "personal" | "office") {
    void send("/api/me/overlaps", "POST", { date, cancel: side, remember });
  }

  function keepBoth(date: string) {
    if (remember) {
      void send("/api/me/overlaps", "PUT", { rule: "keep_both" });
    } else {
      setDismissed((prev) => new Set(prev).add(date));
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <div>
        <h2 className="font-semibold">Two coffees coming up</h2>
        <p className="text-sm">
          You&apos;ve got both a personal and an office coffee on the same day. That&apos;s fine —
          they&apos;re billed separately, so we&apos;ll keep both unless you&apos;d rather not.
        </p>
      </div>

      {visible.map((day) => {
        const office = day.offices[0];
        const officeDeclinable = day.offices.some((o) => o.canDecline);
        return (
          <div
            key={day.date}
            className="flex flex-col gap-2 rounded-md border border-amber-200 bg-white p-3"
          >
            <p className="text-sm text-neutral-700">
              <span className="font-medium">{day.date}</span> — personal{" "}
              <span className="font-medium">{day.personal.drink}</span> and office{" "}
              <span className="font-medium">{office?.drink}</span>
              {office ? ` from ${office.company}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => keepBoth(day.date)}
                className="rounded-md bg-amber-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Keep both
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => cancel(day.date, "personal")}
                className="rounded-md border border-amber-800 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                Skip my personal coffee
              </button>
              <button
                type="button"
                disabled={busy || !officeDeclinable}
                title={
                  officeDeclinable
                    ? undefined
                    : "Your company doesn't allow skipping office coffee."
                }
                onClick={() => cancel(day.date, "office")}
                className="rounded-md border border-amber-800 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                Skip the office coffee
              </button>
            </div>
          </div>
        );
      })}

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember my choice for future overlap days (no daily asking)
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
