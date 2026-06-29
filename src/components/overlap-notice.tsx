"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";

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
    <Card className="flex flex-col gap-3 bg-amber p-5 text-coffee shadow-card">
      <div className="flex flex-col gap-1">
        <SectionLabel>Both coffees coming up</SectionLabel>
        <p className="text-sm">
          A personal and an office coffee on the same day. They&apos;re on different cards — no
          conflict — so we&apos;ll keep both unless you&apos;d rather not.
        </p>
      </div>

      {visible.map((day) => {
        const office = day.offices[0];
        const officeDeclinable = day.offices.some((o) => o.canDecline);
        return (
          <div
            key={day.date}
            className="flex flex-col gap-3 rounded-2xl bg-surface p-4"
          >
            <p className="text-sm text-coffee">
              <span className="font-semibold text-espresso">{day.date}</span> — personal{" "}
              <span className="font-semibold text-espresso">{day.personal.drink}</span> and office{" "}
              <span className="font-semibold text-espresso">{office?.drink}</span>
              {office ? ` from ${office.company}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => keepBoth(day.date)}>
                Keep both
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => cancel(day.date, "personal")}>
                Skip personal
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !officeDeclinable}
                title={
                  officeDeclinable ? undefined : "Your company doesn't allow skipping office coffee."
                }
                onClick={() => cancel(day.date, "office")}
              >
                Skip office
              </Button>
            </div>
          </div>
        );
      })}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember my choice for future overlap days (no daily asking)
      </label>
      {error && <p className="text-sm text-terracotta">{error}</p>}
    </Card>
  );
}
