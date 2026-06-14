"use client";

import { useState } from "react";

function useAdminAction(url: string, body?: unknown) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function run() {
    setState("busy");
    try {
      const response = await fetch(url, {
        method: "POST",
        ...(body !== undefined
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      setState(response.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return { state, run };
}

const buttonClass =
  "rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50";

/** Runs ensureIndexes() — part of provisioning a fresh database. */
export function AdminSetupButton() {
  const { state, run } = useAdminAction("/api/admin/indexes");

  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "busy"}
      className={buttonClass}
      title="Create database indexes (safe to re-run)"
    >
      {state === "busy"
        ? "Setting up…"
        : state === "done"
          ? "Indexes ✓"
          : state === "error"
            ? "Failed — retry"
            : "Set up DB indexes"}
    </button>
  );
}

/** Runs the Phase A cafés → vendors data migration (up only — rollback is
 * a deliberate API call, not a button). */
export function AdminMigrateButton() {
  const { state, run } = useAdminAction("/api/admin/migrations/phase-a", { direction: "up" });

  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "busy"}
      className={buttonClass}
      title="Copy cafés into vendors and rekey orders (safe to re-run)"
    >
      {state === "busy"
        ? "Migrating…"
        : state === "done"
          ? "Migrated ✓"
          : state === "error"
            ? "Failed — retry"
            : "Migrate cafés → vendors"}
    </button>
  );
}

/** Seeds the OptionTaxonomy and absorbs legacy preference values (Phase C,
 * up only — rollback is a deliberate API call). */
export function AdminSeedTaxonomyButton() {
  const { state, run } = useAdminAction("/api/admin/migrations/phase-c", { direction: "up" });

  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "busy"}
      className={buttonClass}
      title="Seed the platform menu taxonomy and absorb existing preferences (safe to re-run)"
    >
      {state === "busy"
        ? "Seeding…"
        : state === "done"
          ? "Taxonomy ✓"
          : state === "error"
            ? "Failed — retry"
            : "Seed menu taxonomy"}
    </button>
  );
}
