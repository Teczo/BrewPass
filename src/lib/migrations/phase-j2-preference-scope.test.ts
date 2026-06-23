import { describe, expect, it } from "vitest";

import { scopeBackfillPatch } from "@/lib/migrations/phase-j2-preference-scope";
import { PERSONAL_SCOPE } from "@/lib/preferences";

describe("scopeBackfillPatch", () => {
  it("stamps personal scope on a preference missing it", () => {
    expect(scopeBackfillPatch({})).toEqual({ scope: PERSONAL_SCOPE });
  });

  it("never clobbers an existing personal scope (idempotent)", () => {
    expect(scopeBackfillPatch({ scope: PERSONAL_SCOPE })).toEqual({});
  });

  it("never clobbers an existing office scope", () => {
    expect(scopeBackfillPatch({ scope: "5f1d7a2b3c4d5e6f7a8b9c0d" })).toEqual({});
  });
});
