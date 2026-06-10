"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface CorporateMemberRow {
  id: string;
  name: string;
  email: string;
  quotaUsed: number | null;
  quotaTotal: number | null;
}

export interface CorporateAccountJson {
  id: string;
  company: string;
  seatCount: number;
  status: string | null;
  currentPeriodEnd: string | null;
  members: CorporateMemberRow[];
}

function useCorpAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(url: string, method: string, payload: object) {
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
      if (body?.url) {
        window.location.assign(body.url as string);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

export function CreateCorporateAccount() {
  const { run, busy, error } = useCorpAction();
  const [company, setCompany] = useState("");

  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run("/api/corporate", "POST", { company });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Company name
        <input
          className="rounded-md border border-neutral-300 px-3 py-2"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          required
          minLength={2}
          maxLength={160}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-amber-800 px-4 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        Create corporate account
      </button>
    </form>
  );
}

export function CorporateManager({ account }: { account: CorporateAccountJson }) {
  const { run, busy, error } = useCorpAction();
  const [seats, setSeats] = useState(account.seatCount);
  const [email, setEmail] = useState("");

  const hasLiveSub = account.status !== null && account.status !== "canceled";
  const periodEnd = account.currentPeriodEnd
    ? new Date(account.currentPeriodEnd).toLocaleDateString("en-MY", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{account.company}</h2>
            <p className="text-sm text-neutral-500">
              {hasLiveSub
                ? `${account.status} · ${account.seatCount} seats${periodEnd ? ` · renews ${periodEnd}` : ""}`
                : "No subscription yet"}
            </p>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Seats
            <input
              type="number"
              min={Math.max(1, account.members.length)}
              max={500}
              className="w-28 rounded-md border border-neutral-300 px-3 py-2"
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
            />
          </label>
          {hasLiveSub ? (
            <button
              type="button"
              disabled={busy || seats === account.seatCount}
              onClick={() => run("/api/corporate/seats", "PATCH", { seats })}
              className="rounded-md border border-amber-800 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
            >
              Update seats (prorated)
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => run("/api/corporate/checkout", "POST", { seats })}
              className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Subscribe — RM199/seat
            </button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <h2 className="font-semibold">
          Members ({account.members.length}/{account.seatCount})
        </h2>
        <ul className="flex flex-col">
          {account.members.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between border-b border-neutral-100 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{member.name || "(no name)"}</span>{" "}
                <span className="text-neutral-500">{member.email}</span>
                {member.quotaTotal !== null && (
                  <span className="ml-2 text-xs text-neutral-400">
                    {member.quotaUsed}/{member.quotaTotal} used this period
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run("/api/corporate/members", "DELETE", { userId: member.id })}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
          {account.members.length === 0 && (
            <li className="py-2 text-sm text-neutral-400">No members yet.</li>
          )}
        </ul>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            placeholder="member@company.com (they must sign up first)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !email.includes("@")}
            onClick={() => {
              run("/api/corporate/members", "POST", { email });
              setEmail("");
            }}
            className="rounded-md border border-amber-800 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
          >
            Add member
          </button>
        </div>
      </section>
    </div>
  );
}
