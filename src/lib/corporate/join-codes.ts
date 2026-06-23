import { randomInt } from "node:crypto";

import type { CorporateJoinCodeType } from "@/lib/models";

/**
 * Phase J.1 join-code helpers. Pure decision/format logic lives here (unit
 * tested); the routes own the DB I/O and the atomic claim.
 */

/** Ambiguity-free charset: no 0/O/1/I to keep codes easy to read out loud. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" as const;
export const JOIN_CODE_LENGTH = 8;

const JOIN_CODE_RE = new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`);

/** Normalize user input to the canonical form: uppercase, spaces/hyphens
 * stripped. Members may type `abcd-2345` or `abcd 2345`; we store `ABCD2345`. */
export function normalizeJoinCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidJoinCodeFormat(code: string): boolean {
  return JOIN_CODE_RE.test(code);
}

/** Generate a random, format-valid join code. Uses crypto `randomInt` for an
 * unbiased pick over the charset. */
export function generateJoinCode(): string {
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    out += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return out;
}

/** The effective redemption cap: `single_use` is implicitly one; a reusable
 * code is capped only if the owner set `redemptionCap`. */
export function effectiveCap(
  type: CorporateJoinCodeType,
  redemptionCap: number | undefined,
): number | undefined {
  if (type === "single_use") return 1;
  return redemptionCap;
}

export type RedemptionRefusal =
  | "inactive"
  | "exhausted"
  | "already_redeemed"
  | "already_member";

export interface RedemptionState {
  active: boolean;
  type: CorporateJoinCodeType;
  redemptionCap?: number;
  redeemedCount: number;
  /** Hex ids of users who already redeemed this code. */
  redeemedByHex: string[];
}

/**
 * Pure (unit-tested) decision for whether `userIdHex` may redeem a code in the
 * given state. `isAlreadyMember` is the membership check the caller resolves
 * separately. Order of refusals is deliberate: membership first (most useful
 * message), then the code's own validity.
 */
export function evaluateRedemption(
  state: RedemptionState,
  userIdHex: string,
  isAlreadyMember: boolean,
): { ok: true } | { ok: false; reason: RedemptionRefusal } {
  if (isAlreadyMember) return { ok: false, reason: "already_member" };
  if (!state.active) return { ok: false, reason: "inactive" };
  if (state.redeemedByHex.includes(userIdHex)) {
    return { ok: false, reason: "already_redeemed" };
  }
  const cap = effectiveCap(state.type, state.redemptionCap);
  if (cap !== undefined && state.redeemedCount >= cap) {
    return { ok: false, reason: "exhausted" };
  }
  return { ok: true };
}

/** A code is fully spent (no further redemptions possible) once it hits its
 * effective cap. Used to flip `active` off after a redemption. */
export function isSpentAfterRedemption(
  type: CorporateJoinCodeType,
  redemptionCap: number | undefined,
  redeemedCountAfter: number,
): boolean {
  const cap = effectiveCap(type, redemptionCap);
  return cap !== undefined && redeemedCountAfter >= cap;
}

/** User-facing message for each refusal reason. */
export function redemptionRefusalMessage(reason: RedemptionRefusal): string {
  switch (reason) {
    case "already_member":
      return "You're already a member of this company.";
    case "inactive":
      return "This join code is no longer active.";
    case "already_redeemed":
      return "You've already used this join code.";
    case "exhausted":
      return "This join code has reached its limit.";
  }
}
