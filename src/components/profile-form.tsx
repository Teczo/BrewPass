"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";

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
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field
        id="name"
        label="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
      />
      <Field
        id="phone"
        label="Phone"
        type="tel"
        placeholder="+60 12-345 6789"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
        hint="We'll only message you about your coffee — never marketing."
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-coffee">
          I&apos;m signing up as
        </legend>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((option) => (
            <Chip
              key={option.value}
              selected={role === option.value}
              onClick={() => setRole(option.value)}
              aria-pressed={role === option.value}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      {error && <p className="text-sm text-terracotta">{error}</p>}
      <Button type="submit" disabled={saving} fullWidth>
        {saving ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
