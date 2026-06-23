import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import {
  officePreferenceFilter,
  officeScope,
  personalPreferenceFilter,
  PERSONAL_SCOPE,
} from "@/lib/preferences";

describe("officeScope", () => {
  it("is the membership's hex id", () => {
    const id = new ObjectId();
    expect(officeScope(id)).toBe(id.toHexString());
  });
});

describe("personalPreferenceFilter", () => {
  it("matches the personal scope and legacy rows missing a scope", () => {
    const userId = new ObjectId();
    const filter = personalPreferenceFilter(userId) as {
      userId: ObjectId;
      scope: { $in: Array<string | null> };
    };
    expect(filter.userId).toBe(userId);
    expect(filter.scope.$in).toContain(PERSONAL_SCOPE);
    // null in an $in matches missing fields too (pre-migration rows).
    expect(filter.scope.$in).toContain(null);
  });

  it("never matches an office scope", () => {
    const userId = new ObjectId();
    const office = officeScope(new ObjectId());
    const filter = personalPreferenceFilter(userId) as { scope: { $in: Array<string | null> } };
    expect(filter.scope.$in).not.toContain(office);
  });
});

describe("officePreferenceFilter", () => {
  it("scopes to the membership id for the given user", () => {
    const userId = new ObjectId();
    const membershipId = new ObjectId();
    expect(officePreferenceFilter(userId, membershipId)).toEqual({
      userId,
      scope: membershipId.toHexString(),
    });
  });
});
