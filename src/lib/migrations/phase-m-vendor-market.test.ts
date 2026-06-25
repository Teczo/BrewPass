import { describe, expect, it } from "vitest";

import { marketBackfillPatch } from "@/lib/migrations/phase-m-vendor-market";

describe("marketBackfillPatch (Phase M)", () => {
  it("stamps MY on a vendor with no market", () => {
    expect(marketBackfillPatch({})).toEqual({ market: "MY" });
    expect(marketBackfillPatch({ market: undefined })).toEqual({ market: "MY" });
  });

  it("leaves an already-set market untouched (idempotent re-runs)", () => {
    expect(marketBackfillPatch({ market: "MY" })).toEqual({});
    expect(marketBackfillPatch({ market: "AU" })).toEqual({});
  });

  it("repairs an invalid market value to MY", () => {
    expect(marketBackfillPatch({ market: "SG" })).toEqual({ market: "MY" });
  });
});
