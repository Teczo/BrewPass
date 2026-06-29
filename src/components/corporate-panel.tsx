"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

/**
 * The create-company form. Per Phase J.4 the old seat-model manager (member
 * email-add + seat checkout) is replaced by the owner dashboard
 * (`CorporateOwnerDashboard`); this component is only the first step that
 * creates the `CorporateAccount`.
 */
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
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run("/api/corporate", "POST", { company });
      }}
    >
      <Field
        id="company"
        label="Company name"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        required
        minLength={2}
        maxLength={160}
      />
      {error && <p className="text-sm text-terracotta">{error}</p>}
      <Button type="submit" disabled={busy} fullWidth>
        Create corporate account
      </Button>
    </form>
  );
}
