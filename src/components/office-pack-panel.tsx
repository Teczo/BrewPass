"use client";

import { useCallback, useEffect, useState } from "react";

import type { DrinkOptions } from "@/lib/taxonomy-options";

interface MemberJson {
  membershipId: string;
  name: string;
  email: string;
}
interface AvailablePackJson {
  id: string;
  name: string;
  vendorName: string;
  packSize: number | null;
  packPriceSen: number | null;
  packMode: "fixed_drink" | "buyer_choice" | null;
  fixedDrink: { drink: string } | null;
}
interface CurrentPurchaseJson {
  status: string;
  packSnapshot: { packSize: number; packPriceSen: number; packMode: string };
  assignments: { corporateMembershipId: string }[];
  topUpMembershipIds: string[];
}
interface PacksResponse {
  date: string;
  cardOnFile: boolean;
  members: MemberJson[];
  availablePacks: AvailablePackJson[];
  currentPurchase: CurrentPurchaseJson | null;
}

const fmt = (sen: number) => `RM${(sen / 100).toFixed(2)}`;

/**
 * Phase K.1 — optional savings nudge for the team admin (rule #21). Surfaces
 * vendor packs available for a day; never replaces the one-tap "buy the usual".
 * The admin picks a pack, selects members (first packSize fill the pack, the
 * rest become normally-routed top-ups), and buys — one company-card charge at
 * cutoff. Editable via cancel until that day's cutoff.
 */
export function OfficePackPanel({
  defaultDate,
  drinkOptions,
}: {
  defaultDate: string;
  drinkOptions: DrinkOptions;
}) {
  const [date, setDate] = useState(defaultDate);
  const [data, setData] = useState<PacksResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedPackId, setSelectedPackId] = useState<string>("");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [buyerDrink, setBuyerDrink] = useState(drinkOptions.drinks[0]?.value ?? "Flat White");

  // Reload used by event handlers (after a mutation). setState in an event
  // handler is fine; the initial load is the inline effect below.
  const load = useCallback(async (forDate: string) => {
    try {
      const res = await fetch(`/api/corporate/packs?date=${forDate}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load packs");
      setData(body as PacksResponse);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/corporate/packs?date=${date}`, { cache: "no-store" });
        const body = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(body?.error ?? "Couldn't load packs");
        setData(body as PacksResponse);
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Something went wrong");
      }
    })();
    return () => {
      active = false;
    };
  }, [date]);

  async function mutate(method: string, payload: object): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/corporate/packs", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Action failed");
      await load(date);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const selectedPack = data?.availablePacks.find((p) => p.id === selectedPackId) ?? null;

  function toggleMember(id: string) {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buy() {
    if (!selectedPack || selectedPack.packSize == null) return;
    const ids = [...selectedMembers];
    const packSize = selectedPack.packSize;
    const assignedIds = ids.slice(0, packSize);
    const topUpIds = ids.slice(packSize);
    const drinkSpec =
      selectedPack.packMode === "buyer_choice"
        ? { drink: buyerDrink, size: "regular", milk: "Fresh milk", sugar: 0, strength: "regular" }
        : undefined;
    void mutate("POST", {
      date,
      vendorPromotionId: selectedPack.id,
      assignments: assignedIds.map((membershipId) => ({
        corporateMembershipId: membershipId,
        ...(drinkSpec ? { drinkSpec } : {}),
      })),
      topUpMembershipIds: topUpIds,
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Vendor packs — optional savings</h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
      </div>
      <p className="text-sm text-neutral-500">
        A discounted multi-coffee pack from a vendor can beat per-member coffees. Buying a pack
        replaces per-member office selection for that day; you don&apos;t have to use one.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && !data.cardOnFile && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          Add a company card above to buy a pack.
        </p>
      )}

      {data?.currentPurchase ? (
        <div className="flex flex-col gap-2 rounded-md bg-amber-50 p-3 text-sm">
          <p>
            <span className="font-medium">Pack booked for {data.date}</span> —{" "}
            {data.currentPurchase.packSnapshot.packSize}× for{" "}
            {fmt(data.currentPurchase.packSnapshot.packPriceSen)} ·{" "}
            {data.currentPurchase.assignments.length} assigned ·{" "}
            {data.currentPurchase.topUpMembershipIds.length} top-ups ·{" "}
            <span className="text-neutral-500">{data.currentPurchase.status}</span>
          </p>
          {data.currentPurchase.status === "pending" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => mutate("DELETE", { date })}
              className="w-fit rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Cancel pack
            </button>
          )}
        </div>
      ) : data && data.availablePacks.length === 0 ? (
        <p className="text-sm text-neutral-400">No packs available from vendors for this day.</p>
      ) : (
        data && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              {data.availablePacks.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2 text-sm ${
                    selectedPackId === p.id ? "border-amber-800 bg-amber-50" : "border-neutral-200"
                  }`}
                >
                  <span>
                    <input
                      type="radio"
                      name="pack"
                      className="mr-2"
                      checked={selectedPackId === p.id}
                      onChange={() => {
                        setSelectedPackId(p.id);
                        setSelectedMembers(new Set());
                      }}
                    />
                    <span className="font-medium">{p.name}</span> · {p.vendorName}
                    <span className="block pl-6 text-xs text-neutral-500">
                      {p.packSize}× for {p.packPriceSen != null ? fmt(p.packPriceSen) : "—"} ·{" "}
                      {p.packMode === "fixed_drink"
                        ? `fixed ${p.fixedDrink?.drink ?? "drink"}`
                        : "buyer's choice"}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {selectedPack && (
              <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
                {selectedPack.packMode === "buyer_choice" && (
                  <label className="flex flex-col gap-1 text-sm">
                    Drink for the pack
                    <select
                      className="w-fit rounded-md border border-neutral-300 px-2 py-1.5"
                      value={buyerDrink}
                      onChange={(e) => setBuyerDrink(e.target.value)}
                    >
                      {drinkOptions.drinks.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="text-xs text-neutral-500">
                  Pick members. The first {selectedPack.packSize} fill the pack; anyone beyond that
                  is added as a normally-routed top-up coffee.
                </p>
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {data.members.map((m) => (
                    <li key={m.membershipId}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedMembers.has(m.membershipId)}
                          onChange={() => toggleMember(m.membershipId)}
                        />
                        {m.name || m.email}
                      </label>
                    </li>
                  ))}
                  {data.members.length === 0 && (
                    <li className="text-xs text-neutral-400">No members yet.</li>
                  )}
                </ul>
                <p className="text-xs text-neutral-500">
                  {Math.min(selectedMembers.size, selectedPack.packSize ?? 0)} in pack ·{" "}
                  {Math.max(0, selectedMembers.size - (selectedPack.packSize ?? 0))} top-ups
                </p>
                <button
                  type="button"
                  disabled={busy || !data.cardOnFile || selectedMembers.size === 0}
                  onClick={buy}
                  className="w-fit rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Buy pack for {date}
                </button>
              </div>
            )}
          </div>
        )
      )}
    </section>
  );
}
