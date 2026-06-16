import { describe, expect, it } from "vitest";

import { evaluateMenuWrite, menuWriteSchema } from "@/lib/menu-write";

const input = (overrides: Partial<{ available: boolean; priceSen?: number }> = {}) => ({
  slug: "flat_white",
  available: true,
  ...overrides,
});

describe("evaluateMenuWrite", () => {
  it("rejects an unknown/inactive taxonomy slug", () => {
    const result = evaluateMenuWrite(input(), null);
    expect(result).toEqual({ ok: false, error: "Unknown or inactive menu option." });
  });

  it("rejects size and strength as not menu-managed", () => {
    expect(evaluateMenuWrite(input(), { category: "size" }).ok).toBe(false);
    expect(evaluateMenuWrite(input(), { category: "strength" }).ok).toBe(false);
  });

  it("requires a price before a priced item can be made available", () => {
    const drink = evaluateMenuWrite(input({ available: true }), { category: "drink" });
    expect(drink.ok).toBe(false);
    const addon = evaluateMenuWrite(input({ available: true }), { category: "addon" });
    expect(addon.ok).toBe(false);
  });

  it("allows a priced item with a price, flagged priced", () => {
    const result = evaluateMenuWrite(input({ available: true, priceSen: 1200 }), {
      category: "drink",
    });
    expect(result).toEqual({ ok: true, priced: true });
  });

  it("allows an off-menu priced item without a price", () => {
    const result = evaluateMenuWrite(input({ available: false }), { category: "drink" });
    expect(result).toEqual({ ok: true, priced: true });
  });

  it("treats milk as availability-only (no price required)", () => {
    const result = evaluateMenuWrite(input({ available: true }), { category: "milk" });
    expect(result).toEqual({ ok: true, priced: false });
  });
});

describe("menuWriteSchema", () => {
  it("rejects a price above the bound", () => {
    expect(
      menuWriteSchema.safeParse({ slug: "x", available: true, priceSen: 100_001 }).success,
    ).toBe(false);
  });

  it("accepts the manual-edit payload shape", () => {
    expect(
      menuWriteSchema.safeParse({ slug: "flat_white", available: true, priceSen: 1200 }).success,
    ).toBe(true);
  });
});
