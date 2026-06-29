"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { StatusPill } from "@/components/ui/status-pill";

export interface MemberOfficeJson {
  membershipId: string;
  company: string;
  joinedVia: string;
}

const REASSURANCES = [
  "This won't touch your personal BrewPass",
  "Your plan & preferences stay exactly as they are",
  "Office coffee is billed to the company card, never yours",
  "You can get a personal and an office coffee the same day",
];

/**
 * Phase J.4 — the member-side entry point: redeem a join code to belong to a
 * company, and see which offices you're already in. Joining never changes your
 * personal BrewPass account (rule #16); your office coffee is billed to the
 * company card, not yours.
 */
export function JoinCompanyPanel({ offices }: { offices: MemberOfficeJson[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  async function redeem() {
    setBusy(true);
    setError(null);
    setJoined(null);
    try {
      const response = await fetch("/api/corporate/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not join");
      setJoined(body?.company ?? "the company");
      setCode("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      {offices.length > 0 ? (
        <>
          <SectionLabel>Your offices</SectionLabel>
          <ul className="flex flex-col gap-2">
            {offices.map((office) => (
              <li key={office.membershipId} className="flex items-center justify-between gap-3">
                <span className="font-semibold text-espresso">{office.company}</span>
                <StatusPill tone="active">Joined</StatusPill>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h2 className="font-display text-xl text-espresso">Join your company</h2>
          <p className="text-sm text-coffee">
            Got a join code from work? Enter it to start getting office coffee — on the
            company&apos;s card.
          </p>
        </>
      )}

      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-coffee">Join code</span>
          <Input
            className="font-mono tracking-widest uppercase"
            placeholder="BREW-••••"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={20}
          />
        </div>
        <Button disabled={busy || code.trim().length < 4} onClick={redeem}>
          Join
        </Button>
      </div>

      {joined ? (
        <Notice tone="sage" icon="✓">
          You&apos;ve joined {joined}. Your personal coffee is completely untouched — set your
          office coffee below, or keep the company default.
        </Notice>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {REASSURANCES.map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm text-coffee">
              <span className="text-sage">✓</span>
              {line}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-terracotta">{error}</p>}
    </Card>
  );
}
