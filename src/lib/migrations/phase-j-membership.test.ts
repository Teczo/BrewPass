import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import {
  legacyMembershipDoc,
  restoredRole,
  type RoleRestoreInput,
} from "@/lib/migrations/phase-j-membership";
import { corporateMembershipSchema } from "@/lib/models";
import { DEFAULT_TENANT_ID, externalIdSchema } from "@/lib/models/shared";

describe("restoredRole", () => {
  it("restores a flipped member with no student proof to individual", () => {
    expect(restoredRole({ role: "corporate" })).toBe("individual");
  });

  it("restores a flipped member with student proof to student", () => {
    const input: RoleRestoreInput = {
      role: "corporate",
      studentVerifiedAt: new Date("2026-02-01T00:00:00Z"),
    };
    expect(restoredRole(input)).toBe("student");
  });

  it("leaves a member already on a personal role untouched (idempotent)", () => {
    expect(restoredRole({ role: "individual" })).toBe("individual");
    expect(restoredRole({ role: "student" })).toBe("student");
  });

  it("never downgrades a privileged role", () => {
    expect(restoredRole({ role: "admin" })).toBe("admin");
    expect(restoredRole({ role: "vendor" })).toBe("vendor");
    expect(restoredRole({ role: "cafe" })).toBe("cafe");
  });
});

describe("legacyMembershipDoc", () => {
  const accountId = new ObjectId();
  const userId = new ObjectId();
  const now = new Date("2026-06-23T09:00:00Z");

  it("builds an active, email-joined membership that satisfies the schema", () => {
    const doc = legacyMembershipDoc(accountId, userId, now);
    expect(() => corporateMembershipSchema.parse(doc)).not.toThrow();
    expect(doc.corporateAccountId.equals(accountId)).toBe(true);
    expect(doc.userId.equals(userId)).toBe(true);
    expect(doc.status).toBe("active");
    expect(doc.joinedVia).toBe("email");
    expect(doc.joinedAt).toBe(now);
    expect(doc.createdAt).toBe(now);
  });

  it("stamps the Phase I reservation fields (externalId + tenantId)", () => {
    const doc = legacyMembershipDoc(accountId, userId, now);
    expect(() => externalIdSchema.parse(doc.externalId)).not.toThrow();
    expect(doc.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it("generates a distinct _id and externalId per call", () => {
    const a = legacyMembershipDoc(accountId, userId, now);
    const b = legacyMembershipDoc(accountId, userId, now);
    expect(a._id.equals(b._id)).toBe(false);
    expect(a.externalId).not.toBe(b.externalId);
  });
});
