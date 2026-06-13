"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { VendorMenuItemJson } from "@/lib/serializers";

export interface MenuOptionRow {
  slug: string;
  label: string;
  item: VendorMenuItemJson | null;
}
export interface MenuSection {
  category: "drink" | "milk" | "addon";
  options: MenuOptionRow[];
}

const SECTION_TITLES: Record<MenuSection["category"], string> = {
  drink: "Drinks",
  milk: "Milks",
  addon: "Add-ons",
};

const PRICED: Record<MenuSection["category"], boolean> = {
  drink: true,
  milk: false,
  addon: true,
};

/** Sen ↔ ringgit string for the price inputs (kept in sen on the wire). */
function senToInput(priceSen: number | null): string {
  return priceSen === null ? "" : (priceSen / 100).toFixed(2);
}

export function VendorMenuManager({ sections }: { sections: MenuSection[] }) {
  const router = useRouter();
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Local price drafts so typing doesn't fight the server round-trip.
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>(() => {
    const drafts: Record<string, string> = {};
    for (const section of sections) {
      for (const option of section.options) {
        drafts[option.slug] = senToInput(option.item?.priceSen ?? null);
      }
    }
    return drafts;
  });

  async function save(slug: string, body: { available: boolean; priceSen?: number }) {
    setBusySlug(slug);
    setError(null);
    try {
      const response = await fetch("/api/vendor/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...body }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Save failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusySlug(null);
    }
  }

  function priceSenFor(slug: string): number | undefined {
    const draft = priceDrafts[slug];
    if (draft === undefined || draft.trim() === "") return undefined;
    const ringgit = Number(draft);
    if (!Number.isFinite(ringgit) || ringgit < 0) return undefined;
    return Math.round(ringgit * 100);
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {sections.map((section) => (
        <section key={section.category} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{SECTION_TITLES[section.category]}</h2>
          <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {section.options.map((option) => {
              const available = option.item?.available ?? false;
              const priced = PRICED[section.category];
              const busy = busySlug === option.slug;
              return (
                <li key={option.slug} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="flex-1 font-medium">{option.label}</span>
                  {priced && (
                    <label className="flex items-center gap-1 text-sm">
                      <span className="text-neutral-400">RM</span>
                      <input
                        type="number"
                        min={0}
                        step="0.10"
                        inputMode="decimal"
                        className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm"
                        placeholder="0.00"
                        value={priceDrafts[option.slug] ?? ""}
                        onChange={(e) =>
                          setPriceDrafts((prev) => ({ ...prev, [option.slug]: e.target.value }))
                        }
                        onBlur={() => {
                          if (available) {
                            const priceSen = priceSenFor(option.slug);
                            if (priceSen !== undefined) save(option.slug, { available, priceSen });
                          }
                        }}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      save(option.slug, {
                        available: !available,
                        ...(priced ? { priceSen: priceSenFor(option.slug) } : {}),
                      })
                    }
                    className={`rounded px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                      available
                        ? "bg-green-100 text-green-800 hover:bg-green-200"
                        : "border border-neutral-300 text-neutral-500 hover:bg-neutral-50"
                    }`}
                  >
                    {available ? "Available" : "Off menu"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
