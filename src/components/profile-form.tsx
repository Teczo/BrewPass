"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ROLES = [
  { value: "individual", label: "Individual" },
  { value: "corporate", label: "Corporate" },
  { value: "student", label: "Student" },
] as const;

export interface ProfileFormProps {
  initial: { name: string; phone: string; role: string };
  nextHref: string;
}

export function ProfileForm({ initial, nextHref }: ProfileFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [role, setRole] = useState(
    ROLES.some((r) => r.value === initial.role) ? initial.role : "individual",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, role }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save profile");
      }
      router.push(nextHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Full name
        <input
          className="rounded-md border border-neutral-300 px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Phone
        <input
          className="rounded-md border border-neutral-300 px-3 py-2"
          type="tel"
          placeholder="+60123456789"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </label>
      <fieldset className="flex flex-col gap-2 text-sm font-medium">
        <legend className="mb-1">I&apos;m signing up as</legend>
        <div className="flex gap-2">
          {ROLES.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-md border px-3 py-2 ${
                role === option.value
                  ? "border-amber-800 bg-amber-50 text-amber-900"
                  : "border-neutral-300"
              }`}
            >
              <input
                type="radio"
                name="role"
                className="sr-only"
                value={option.value}
                checked={role === option.value}
                onChange={() => setRole(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-amber-800 px-4 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
