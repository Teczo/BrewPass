"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { MenuTaxonomyOption } from "@/lib/menu-extraction";
import type { MenuDraftRow } from "@/lib/models";
import type { VendorMenuDraftJson } from "@/lib/serializers";

/**
 * Phase C.5 review UI. The vendor uploads a menu screenshot, the AI proposes
 * taxonomy-mapped rows, and the vendor edits and confirms. Nothing here is
 * live until "Confirm & publish" replays each row through the menu-write gate
 * server-side. Confidence is shown only to flag what to scrutinise — it never
 * auto-accepts a row.
 */

const PRICED_CATEGORIES = new Set(["drink", "addon"]);

interface ConfirmResult {
  rawText: string;
  status: "published" | "skipped";
  slug?: string;
  reason?: string;
}

function readAsImageInput(file: File): Promise<{ mediaType: string; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({ mediaType: file.type, dataBase64: result.slice(result.indexOf(",") + 1) });
    };
    reader.readAsDataURL(file);
  });
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.8
      ? "bg-green-100 text-green-800"
      : value >= 0.5
        ? "bg-amber-100 text-amber-800"
        : "bg-neutral-100 text-neutral-600";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{pct}%</span>;
}

export function VendorMenuOnboarding({
  options,
  initialDraft,
}: {
  options: MenuTaxonomyOption[];
  initialDraft: VendorMenuDraftJson | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<MenuDraftRow[]>(initialDraft?.rows ?? []);
  const [busy, setBusy] = useState<null | "extract" | "save" | "confirm">(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ConfirmResult[] | null>(null);
  const [open, setOpen] = useState(rows.length > 0);

  const categoryBySlug = useMemo(
    () => new Map(options.map((option) => [option.slug, option.category])),
    [options],
  );
  const grouped = useMemo(() => {
    return {
      drink: options.filter((o) => o.category === "drink"),
      milk: options.filter((o) => o.category === "milk"),
      addon: options.filter((o) => o.category === "addon"),
    };
  }, [options]);

  const needsInput = rows.filter((row) => row.matchedTaxonomyRef === null).length;

  function patchRow(index: number, patch: Partial<MenuDraftRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setResults(null);
  }
  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setResults(null);
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy("extract");
    setError(null);
    setResults(null);
    try {
      const images = await Promise.all(Array.from(files).map(readAsImageInput));
      const response = await fetch("/api/vendor/menu/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Extraction failed.");
      const extracted: MenuDraftRow[] = payload.rows ?? [];
      // Append to any rows already under review rather than discarding them.
      setRows((prev) => [...prev, ...extracted]);
      setOpen(true);
      if (extracted.length === 0) setError("No menu items were found in that image.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft(): Promise<boolean> {
    const response = await fetch("/api/vendor/menu/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? "Couldn't save the draft.");
    }
    return true;
  }

  async function handleSave() {
    setBusy("save");
    setError(null);
    try {
      await saveDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirm() {
    setBusy("confirm");
    setError(null);
    setResults(null);
    try {
      // Persist edits first so confirm replays exactly what's on screen.
      await saveDraft();
      const response = await fetch("/api/vendor/menu/draft/confirm", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Couldn't publish the menu.");
      setResults(payload.results ?? []);
      router.refresh(); // reflect newly published items in the manager below
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const anyBusy = busy !== null;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50/40 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Onboard from a screenshot</h2>
          <p className="text-sm text-neutral-500">
            Upload your existing menu (Grab, Uber, a photo) and we&apos;ll map it onto the BrewPass
            menu for you to review.
          </p>
        </div>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-sm text-amber-800 hover:underline"
          >
            {open ? "Hide" : `Review ${rows.length}`}
          </button>
        )}
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 rounded border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          disabled={anyBusy}
          onChange={(e) => {
            void handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
        {busy === "extract" ? "Reading menu…" : "Upload menu screenshot"}
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {open && rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {needsInput > 0 && (
            <p className="rounded border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900">
              {needsInput} {needsInput === 1 ? "row needs" : "rows need"} your input — pick a menu
              option before publishing. Unmapped rows are skipped.
            </p>
          )}

          <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
            {rows.map((row, index) => {
              const category = row.matchedTaxonomyRef
                ? categoryBySlug.get(row.matchedTaxonomyRef)
                : undefined;
              const priced = category ? PRICED_CATEGORIES.has(category) : true;
              const unmapped = row.matchedTaxonomyRef === null;
              return (
                <li key={index} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex min-w-[8rem] flex-1 flex-col">
                    <span className="font-medium">{row.rawText}</span>
                    {unmapped && (
                      <span className="text-xs font-medium text-amber-700">needs your input</span>
                    )}
                  </div>
                  <ConfidenceBadge value={row.confidence} />
                  <select
                    value={row.matchedTaxonomyRef ?? ""}
                    onChange={(e) =>
                      patchRow(index, { matchedTaxonomyRef: e.target.value || null })
                    }
                    className="rounded border border-neutral-300 px-2 py-1 text-sm"
                  >
                    <option value="">— needs mapping —</option>
                    <optgroup label="Drinks">
                      {grouped.drink.map((o) => (
                        <option key={o.slug} value={o.slug}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Milks">
                      {grouped.milk.map((o) => (
                        <option key={o.slug} value={o.slug}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Add-ons">
                      {grouped.addon.map((o) => (
                        <option key={o.slug} value={o.slug}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  {priced ? (
                    <label className="flex items-center gap-1 text-sm">
                      <span className="text-neutral-400">RM</span>
                      <input
                        type="number"
                        min={0}
                        step="0.10"
                        inputMode="decimal"
                        placeholder="0.00"
                        className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm"
                        value={
                          row.proposedPriceSen === null
                            ? ""
                            : (row.proposedPriceSen / 100).toFixed(2)
                        }
                        onChange={(e) => {
                          const text = e.target.value.trim();
                          const ringgit = Number(text);
                          patchRow(index, {
                            proposedPriceSen:
                              text === "" || !Number.isFinite(ringgit) || ringgit < 0
                                ? null
                                : Math.round(ringgit * 100),
                          });
                        }}
                      />
                    </label>
                  ) : (
                    <span className="w-20 text-center text-xs text-neutral-400">no price</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-sm text-neutral-400 hover:text-red-600"
                    aria-label={`Remove ${row.rawText}`}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={anyBusy}
              className="rounded bg-amber-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-900 disabled:opacity-50"
            >
              {busy === "confirm" ? "Publishing…" : "Confirm & publish"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={anyBusy}
              className="rounded border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              {busy === "save" ? "Saving…" : "Save for later"}
            </button>
            <span className="text-xs text-neutral-400">Nothing goes live until you confirm.</span>
          </div>

          {results && (
            <div className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
              <p className="font-medium">
                Published {results.filter((r) => r.status === "published").length} of{" "}
                {results.length}.
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-neutral-600">
                {results
                  .filter((r) => r.status === "skipped")
                  .map((r, i) => (
                    <li key={i}>
                      Skipped <span className="font-medium">{r.rawText}</span>
                      {r.reason ? ` — ${r.reason}` : ""}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
