import { describe, expect, it } from "vitest";

import {
  effectiveCap,
  evaluateRedemption,
  generateJoinCode,
  isSpentAfterRedemption,
  isValidJoinCodeFormat,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  normalizeJoinCode,
  redemptionRefusalMessage,
  type RedemptionState,
} from "@/lib/corporate/join-codes";

describe("normalizeJoinCode", () => {
  it("uppercases and strips spaces and hyphens", () => {
    expect(normalizeJoinCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeJoinCode(" abcd 2345 ")).toBe("ABCD2345");
  });
});

describe("generateJoinCode", () => {
  it("produces format-valid codes from the unambiguous charset", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateJoinCode();
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      expect(isValidJoinCodeFormat(code)).toBe(true);
      // No ambiguous characters leak in.
      expect(/[01OIL]/.test(code)).toBe(false);
    }
  });

  it("uses only the declared alphabet", () => {
    const allowed = new Set(JOIN_CODE_ALPHABET);
    for (const ch of generateJoinCode()) expect(allowed.has(ch)).toBe(true);
  });
});

describe("isValidJoinCodeFormat", () => {
  it("rejects wrong length, lowercase, and ambiguous characters", () => {
    expect(isValidJoinCodeFormat("ABCD234")).toBe(false); // too short
    expect(isValidJoinCodeFormat("abcd2345")).toBe(false); // lowercase
    expect(isValidJoinCodeFormat("ABCD0345")).toBe(false); // contains 0
  });
});

describe("effectiveCap", () => {
  it("treats single_use as an implicit cap of one", () => {
    expect(effectiveCap("single_use", undefined)).toBe(1);
    expect(effectiveCap("single_use", 50)).toBe(1); // ignores any cap
  });

  it("uses the owner-set cap for reusable, undefined when uncapped", () => {
    expect(effectiveCap("reusable", 25)).toBe(25);
    expect(effectiveCap("reusable", undefined)).toBeUndefined();
  });
});

describe("evaluateRedemption", () => {
  const base: RedemptionState = {
    active: true,
    type: "reusable",
    redeemedCount: 0,
    redeemedByHex: [],
  };
  const user = "aaaaaaaaaaaaaaaaaaaaaaaa";

  it("allows an uncapped reusable code for a new member", () => {
    expect(evaluateRedemption(base, user, false)).toEqual({ ok: true });
  });

  it("refuses an existing active member first", () => {
    expect(evaluateRedemption(base, user, true)).toEqual({
      ok: false,
      reason: "already_member",
    });
  });

  it("refuses an inactive code", () => {
    expect(evaluateRedemption({ ...base, active: false }, user, false)).toEqual({
      ok: false,
      reason: "inactive",
    });
  });

  it("refuses a code the user already redeemed", () => {
    expect(evaluateRedemption({ ...base, redeemedByHex: [user] }, user, false)).toEqual({
      ok: false,
      reason: "already_redeemed",
    });
  });

  it("refuses a spent single_use code", () => {
    const state: RedemptionState = { ...base, type: "single_use", redeemedCount: 1 };
    expect(evaluateRedemption(state, user, false)).toEqual({ ok: false, reason: "exhausted" });
  });

  it("refuses a reusable code that hit its cap", () => {
    const state: RedemptionState = { ...base, redemptionCap: 3, redeemedCount: 3 };
    expect(evaluateRedemption(state, user, false)).toEqual({ ok: false, reason: "exhausted" });
  });

  it("allows a capped reusable code with room left", () => {
    const state: RedemptionState = { ...base, redemptionCap: 3, redeemedCount: 2 };
    expect(evaluateRedemption(state, user, false)).toEqual({ ok: true });
  });
});

describe("isSpentAfterRedemption", () => {
  it("spends a single_use code after one redemption", () => {
    expect(isSpentAfterRedemption("single_use", undefined, 1)).toBe(true);
  });

  it("spends a capped reusable code only at the cap", () => {
    expect(isSpentAfterRedemption("reusable", 3, 2)).toBe(false);
    expect(isSpentAfterRedemption("reusable", 3, 3)).toBe(true);
  });

  it("never spends an uncapped reusable code", () => {
    expect(isSpentAfterRedemption("reusable", undefined, 9999)).toBe(false);
  });
});

describe("redemptionRefusalMessage", () => {
  it("has a message for every refusal reason", () => {
    for (const reason of ["already_member", "inactive", "already_redeemed", "exhausted"] as const) {
      expect(redemptionRefusalMessage(reason)).toBeTruthy();
    }
  });
});
