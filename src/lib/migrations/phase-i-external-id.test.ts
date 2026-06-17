import { describe, expect, it } from "vitest";

import { backfillPatch, PHASE_I_COLLECTIONS } from "@/lib/migrations/phase-i-external-id";
import { DEFAULT_TENANT_ID, externalIdSchema } from "@/lib/models/shared";

describe("backfillPatch", () => {
  it("stamps both reserved fields on a document missing them", () => {
    const patch = backfillPatch({});
    expect(patch.tenantId).toBe(DEFAULT_TENANT_ID);
    // The generated externalId is a valid UUID per the schema.
    expect(() => externalIdSchema.parse(patch.externalId)).not.toThrow();
  });

  it("generates a distinct externalId per call", () => {
    expect(backfillPatch({}).externalId).not.toBe(backfillPatch({}).externalId);
  });

  it("never clobbers an existing externalId", () => {
    const patch = backfillPatch({ externalId: "11111111-1111-1111-1111-111111111111" });
    expect("externalId" in patch).toBe(false);
    expect(patch.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it("never clobbers an existing tenantId (future per-tenant safety)", () => {
    const patch = backfillPatch({ tenantId: "some-future-tenant" });
    expect("tenantId" in patch).toBe(false);
    expect(() => externalIdSchema.parse(patch.externalId)).not.toThrow();
  });

  it("is a no-op for a document that already satisfies the reservation", () => {
    const patch = backfillPatch({
      externalId: "11111111-1111-1111-1111-111111111111",
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(patch).toEqual({});
  });
});

describe("PHASE_I_COLLECTIONS", () => {
  it("covers domain collections but excludes the internal webhook ledger", () => {
    expect(PHASE_I_COLLECTIONS).toContain("orders");
    expect(PHASE_I_COLLECTIONS).toContain("vendors");
    expect(PHASE_I_COLLECTIONS).not.toContain("webhookEvents");
    // No duplicates.
    expect(new Set(PHASE_I_COLLECTIONS).size).toBe(PHASE_I_COLLECTIONS.length);
  });
});
