import { describe, expect, it } from "vitest";

import { resolveOverlapAction, ruleForChoice } from "@/lib/corporate/overlap";

describe("resolveOverlapAction (J.5 standing-rule reconciliation)", () => {
  it("keeps both by default — no rule, or explicit keep_both, never skips", () => {
    expect(resolveOverlapAction(undefined, true)).toBe("none");
    expect(resolveOverlapAction("keep_both", true)).toBe("none");
    // Even when declining is allowed, the default never auto-cancels a side.
    expect(resolveOverlapAction("keep_both", false)).toBe("none");
  });

  it("skip_personal skips the personal side regardless of the office decline gate", () => {
    expect(resolveOverlapAction("skip_personal", true)).toBe("skip_personal");
    // Personal coffee is the member's own — the company gate never applies.
    expect(resolveOverlapAction("skip_personal", false)).toBe("skip_personal");
  });

  it("skip_office only skips the office side when the company allows declining (rule #18)", () => {
    expect(resolveOverlapAction("skip_office", true)).toBe("skip_office");
    // Decline turned off → fall back to keeping both rather than bypass autonomy.
    expect(resolveOverlapAction("skip_office", false)).toBe("none");
  });
});

describe("ruleForChoice (remember-my-choice mapping)", () => {
  it("maps a one-tap cancel into the matching standing rule", () => {
    expect(ruleForChoice("personal")).toBe("skip_personal");
    expect(ruleForChoice("office")).toBe("skip_office");
  });
});
