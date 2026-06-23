"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { DrinkOptions } from "@/lib/taxonomy-options";

export interface DrinkSpecJson {
  drink: string;
  size: "small" | "regular" | "large";
  milk: string;
  sugar: number;
  strength: "mild" | "regular" | "strong" | "double";
}

export interface VendorPromotionJson {
  id: string;
  type: string;
  name: string;
  status: string;
  validFrom: string;
  validUntil: string;
  packSize: number | null;
  packPriceSen: number | null;
  packMode: "fixed_drink" | "buyer_choice" | null;
  fixedDrink: DrinkSpecJson | null;
}

const DEFAULT_SPEC: DrinkSpecJson = {
  drink: "Flat White",
  size: "regular",
  milk: "Fresh milk",
  sugar: 0,
  strength: "regular",
};

function formatMyr(sen: number): string {
  return `RM${(sen / 100).toFixed(2)}`;
}

export function VendorPackManager({
  promotions,
  drinkOptions,
}: {
  promotions: VendorPromotionJson[];
  drinkOptions: DrinkOptions;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [packSize, setPackSize] = useState(10);
  const [priceRm, setPriceRm] = useState("100.00");
  const [packMode, setPackMode] = useState<"fixed_drink" | "buyer_choice">("buyer_choice");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [spec, setSpec] = useState<DrinkSpecJson>(DEFAULT_SPEC);

  async function send(method: string, payload: object): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/vendor/promotions", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Action failed");
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function create() {
    const packPriceSen = Math.round(Number(priceRm) * 100);
    if (!Number.isFinite(packPriceSen) || packPriceSen <= 0) {
      setError("Enter a valid pack price.");
      return;
    }
    void send("POST", {
      name,
      packSize,
      packPriceSen,
      packMode,
      validFrom,
      validUntil,
      ...(packMode === "fixed_drink" ? { fixedDrink: spec } : {}),
    }).then((ok) => {
      if (ok) setName("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <h2 className="font-semibold">Your packs</h2>
        {promotions.length === 0 ? (
          <p className="text-sm text-neutral-400">No packs yet — create one below.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {promotions.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2 text-sm"
              >
                <span>
                  <span className="font-medium">{p.name}</span>{" "}
                  <span className="text-neutral-500">
                    {p.packSize}× for {p.packPriceSen != null ? formatMyr(p.packPriceSen) : "—"} ·{" "}
                    {p.packMode === "fixed_drink"
                      ? `fixed ${p.fixedDrink?.drink ?? "drink"}`
                      : "buyer's choice"}
                  </span>
                  <span className="block text-xs text-neutral-400">
                    {p.validFrom} → {p.validUntil}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.status === "active"
                        ? "bg-green-100 text-green-800"
                        : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {p.status}
                  </span>
                  {(p.status === "active" || p.status === "paused") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        send("PATCH", {
                          promotionId: p.id,
                          status: p.status === "active" ? "paused" : "active",
                        })
                      }
                      className="text-xs text-amber-800 hover:underline disabled:opacity-50"
                    >
                      {p.status === "active" ? "Pause" : "Activate"}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <h2 className="font-semibold">Create a pack</h2>
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            className="rounded-md border border-neutral-300 px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekly team 10-pack"
            maxLength={120}
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Pack size (coffees)
            <input
              type="number"
              min={1}
              max={100}
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={packSize}
              onChange={(e) => setPackSize(Math.max(1, Number(e.target.value)))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Pack price (RM, total)
            <input
              type="text"
              inputMode="decimal"
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={priceRm}
              onChange={(e) => setPriceRm(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Valid from
            <input
              type="date"
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Valid until
            <input
              type="date"
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["buyer_choice", "fixed_drink"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPackMode(mode)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                packMode === mode
                  ? "border-amber-800 bg-amber-800 text-white"
                  : "border-neutral-300 text-neutral-600"
              }`}
            >
              {mode === "buyer_choice" ? "Buyer picks the drinks" : "Same coffee ×N"}
            </button>
          ))}
        </div>

        {packMode === "fixed_drink" && (
          <div className="grid gap-2 rounded-md bg-neutral-50 p-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Drink
              <select
                className="rounded-md border border-neutral-300 px-2 py-1.5"
                value={spec.drink}
                onChange={(e) => setSpec({ ...spec, drink: e.target.value })}
              >
                {drinkOptions.drinks.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Size
              <select
                className="rounded-md border border-neutral-300 px-2 py-1.5"
                value={spec.size}
                onChange={(e) =>
                  setSpec({ ...spec, size: e.target.value as DrinkSpecJson["size"] })
                }
              >
                {drinkOptions.sizes.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Milk
              <select
                className="rounded-md border border-neutral-300 px-2 py-1.5"
                value={spec.milk}
                onChange={(e) => setSpec({ ...spec, milk: e.target.value })}
              >
                {(drinkOptions.milks.length > 0
                  ? drinkOptions.milks
                  : [{ value: spec.milk, label: spec.milk }]
                ).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Strength
              <select
                className="rounded-md border border-neutral-300 px-2 py-1.5"
                value={spec.strength}
                onChange={(e) =>
                  setSpec({ ...spec, strength: e.target.value as DrinkSpecJson["strength"] })
                }
              >
                {drinkOptions.strengths.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <button
          type="button"
          disabled={busy || name.trim().length < 1 || !validFrom || !validUntil}
          onClick={create}
          className="w-fit rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Create pack
        </button>
      </section>
    </div>
  );
}
