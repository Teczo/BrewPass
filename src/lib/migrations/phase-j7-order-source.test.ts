import { describe, expect, it } from "vitest";

import { sourceBackfillPatch } from "@/lib/migrations/phase-j7-order-source";

describe("sourceBackfillPatch", () => {
  it("stamps personal on an order missing source", () => {
    expect(sourceBackfillPatch({})).toEqual({ source: "personal" });
  });

  it("never reclassifies an existing personal order", () => {
    expect(sourceBackfillPatch({ source: "personal" })).toEqual({});
  });

  it("never reclassifies an existing corporate order", () => {
    expect(sourceBackfillPatch({ source: "corporate" })).toEqual({});
  });
});
