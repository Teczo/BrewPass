import { NextResponse } from "next/server";

import type { User } from "@/lib/models";
import { getOrCreateCurrentUser } from "@/lib/users";

/**
 * Shared plumbing for the versioned public API (Phase I.4). The `/v1`
 * surface is a thin, additive layer over the existing domain services and
 * collections — it never changes or degrades the internal API the frontend
 * already uses (critical rule #13). It is authenticated with the same Auth0
 * session as the rest of the app; no separate API-key mechanism is built
 * yet (rule #15 — no speculative integrator shims).
 *
 * Two conventions distinguish `/v1` from the internal routes:
 *  1. Identity at the boundary is always `externalId`, never the raw Mongo
 *     `_id` (critical rule #14). Serializers expose `id = externalId`.
 *  2. Errors use a stable, structured envelope `{ error: { code, message } }`
 *     so clients can branch on `code` without parsing prose.
 */

export type V1ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict";

export function v1Error(status: number, code: V1ErrorCode, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function v1ValidationError(issues: unknown): NextResponse {
  return NextResponse.json(
    { error: { code: "invalid_request", message: "Invalid request.", issues } },
    { status: 400 },
  );
}

/**
 * Resolve the authenticated subscriber for a `/v1` request. Returns either
 * the user or a ready-to-return 401 response, so handlers stay flat:
 *
 *   const auth = await authenticateV1();
 *   if ("response" in auth) return auth.response;
 *   const { user } = auth;
 */
export async function authenticateV1(): Promise<{ user: User } | { response: NextResponse }> {
  const user = await getOrCreateCurrentUser();
  if (!user) return { response: v1Error(401, "unauthorized", "Authentication required.") };
  return { user };
}
