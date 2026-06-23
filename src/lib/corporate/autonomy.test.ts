import { describe, expect, it } from "vitest";

import {
  canMemberDecline,
  canMemberSelectOffice,
  CORPORATE_AUTONOMY_DEFAULTS,
  resolveMemberCanDecline,
  resolveMemberSelfSelect,
  resolveSelectionMode,
  type AutonomySettings,
} from "@/lib/corporate/autonomy";

describe("autonomy resolvers (unset reads as confirmed defaults)", () => {
  it("defaults to individual / self-select on / decline on", () => {
    const empty: AutonomySettings = {};
    expect(resolveSelectionMode(empty)).toBe("individual");
    expect(resolveMemberSelfSelect(empty)).toBe(true);
    expect(resolveMemberCanDecline(empty)).toBe(true);
    // The defaults constant matches what we confirmed with the owner.
    expect(CORPORATE_AUTONOMY_DEFAULTS).toEqual({
      selectionMode: "individual",
      memberSelfSelect: true,
      memberCanDecline: true,
    });
  });

  it("honors explicit values over defaults", () => {
    const account: AutonomySettings = {
      selectionMode: "bundle",
      memberSelfSelect: false,
      memberCanDecline: false,
    };
    expect(resolveSelectionMode(account)).toBe("bundle");
    expect(resolveMemberSelfSelect(account)).toBe(false);
    expect(resolveMemberCanDecline(account)).toBe(false);
  });
});

describe("canMemberSelectOffice", () => {
  it("allows editing in individual mode with self-select on (the default)", () => {
    expect(canMemberSelectOffice({})).toBe(true);
    expect(
      canMemberSelectOffice({ selectionMode: "individual", memberSelfSelect: true }),
    ).toBe(true);
  });

  it("forbids editing when self-select is off", () => {
    expect(
      canMemberSelectOffice({ selectionMode: "individual", memberSelfSelect: false }),
    ).toBe(false);
  });

  it("forbids editing in bundle mode even when self-select is on", () => {
    expect(canMemberSelectOffice({ selectionMode: "bundle", memberSelfSelect: true })).toBe(false);
  });
});

describe("canMemberDecline", () => {
  it("follows the memberCanDecline toggle, defaulting on", () => {
    expect(canMemberDecline({})).toBe(true);
    expect(canMemberDecline({ memberCanDecline: false })).toBe(false);
  });
});
