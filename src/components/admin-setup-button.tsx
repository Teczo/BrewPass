"use client";

import { useState } from "react";

/** Runs ensureIndexes() — part of provisioning a fresh database. */
export function AdminSetupButton() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function run() {
    setState("busy");
    try {
      const response = await fetch("/api/admin/indexes", { method: "POST" });
      setState(response.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "busy"}
      className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
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
