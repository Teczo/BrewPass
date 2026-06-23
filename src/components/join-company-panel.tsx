"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface MemberOfficeJson {
  membershipId: string;
  company: string;
  joinedVia: string;
}

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
    <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="font-semibold">Your offices</h2>
      {offices.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-neutral-600">
          {offices.map((office) => (
            <li key={office.membershipId} className="flex items-center justify-between">
              <span className="font-medium text-neutral-900">{office.company}</span>
              <span className="text-xs text-neutral-400">joined via {office.joinedVia}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">
          You&apos;re not in any company yet. Got a join code from your office? Enter it below.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
          Join a company
          <input
            className="rounded-md border border-neutral-300 px-3 py-2 font-mono tracking-widest uppercase"
            placeholder="ABCD2345"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={20}
          />
        </label>
        <button
          type="button"
          disabled={busy || code.trim().length < 4}
          onClick={redeem}
          className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Join
        </button>
      </div>
      {joined && (
        <p className="text-sm text-green-700">
          Joined {joined} — your office coffee is set up there.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
