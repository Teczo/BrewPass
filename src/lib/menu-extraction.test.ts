import { describe, expect, it } from "vitest";

import {
  mappableOptionsFrom,
  normalizeProposalRows,
  proposalRowToMenuWrite,
} from "@/lib/menu-extraction";
import type { MenuDraftRow } from "@/lib/models";
import type { GroupedTaxonomy } from "@/lib/taxonomy";

const validSlugs = new Set(["flat_white", "oat", "butter_croissant"]);

describe("normalizeProposalRows", () => {
  it("keeps a valid mapped ref and drops an unknown one to null", () => {
    const rows = normalizeProposalRows(
      [
        {
          rawText: "Flat White",
          matchedTaxonomyRef: "flat_white",
          proposedPriceSen: 1200,
          confidence: 0.9,
        },
        {
          rawText: "Dragon Brew",
          matchedTaxonomyRef: "dragon_brew",
          proposedPriceSen: 1500,
          confidence: 0.4,
        },
      ],
      validSlugs,
    );
    expect(rows[0].matchedTaxonomyRef).toBe("flat_white");
    expect(rows[1].matchedTaxonomyRef).toBeNull(); // unknown slug → needs input
  });

  it("skips rows without usable raw text", () => {
    const rows = normalizeProposalRows(
      [
        { rawText: "  ", matchedTaxonomyRef: "flat_white", proposedPriceSen: 1, confidence: 1 },
        { matchedTaxonomyRef: "oat", proposedPriceSen: null, confidence: 1 },
      ],
      validSlugs,
    );
    expect(rows).toHaveLength(0);
  });

  it("coerces bad prices to null and clamps large ones", () => {
    const rows = normalizeProposalRows(
      [
        { rawText: "A", matchedTaxonomyRef: "oat", proposedPriceSen: -5, confidence: 0.5 },
        { rawText: "B", matchedTaxonomyRef: "oat", proposedPriceSen: 9_999_999, confidence: 0.5 },
        { rawText: "C", matchedTaxonomyRef: "oat", proposedPriceSen: "12", confidence: 0.5 },
      ],
      validSlugs,
    );
    expect(rows[0].proposedPriceSen).toBeNull();
    expect(rows[1].proposedPriceSen).toBe(100_000);
    expect(rows[2].proposedPriceSen).toBeNull();
  });

  it("clamps confidence into [0,1] and defaults missing to 0", () => {
    const rows = normalizeProposalRows(
      [
        { rawText: "A", matchedTaxonomyRef: "oat", proposedPriceSen: null, confidence: 5 },
        { rawText: "B", matchedTaxonomyRef: "oat", proposedPriceSen: null, confidence: -1 },
        { rawText: "C", matchedTaxonomyRef: "oat", proposedPriceSen: null },
      ],
      validSlugs,
    );
    expect(rows[0].confidence).toBe(1);
    expect(rows[1].confidence).toBe(0);
    expect(rows[2].confidence).toBe(0);
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizeProposalRows(null, validSlugs)).toEqual([]);
    expect(normalizeProposalRows({ items: [] }, validSlugs)).toEqual([]);
  });
});

describe("proposalRowToMenuWrite", () => {
  const row = (overrides: Partial<MenuDraftRow>): MenuDraftRow => ({
    rawText: "Flat White",
    matchedTaxonomyRef: "flat_white",
    proposedPriceSen: 1200,
    confidence: 0.9,
    ...overrides,
  });

  it("returns null for an unmapped row (it can't be published)", () => {
    expect(proposalRowToMenuWrite(row({ matchedTaxonomyRef: null }))).toBeNull();
  });

  it("publishes a mapped, priced row as available", () => {
    expect(proposalRowToMenuWrite(row({}))).toEqual({
      slug: "flat_white",
      available: true,
      priceSen: 1200,
    });
  });

  it("omits priceSen when no price was proposed (gate then flags it)", () => {
    expect(proposalRowToMenuWrite(row({ proposedPriceSen: null }))).toEqual({
      slug: "flat_white",
      available: true,
    });
  });
});

describe("mappableOptionsFrom", () => {
  it("flattens drink/milk/add-on and excludes size/strength", () => {
    const groups: GroupedTaxonomy = {
      drink: [{ slug: "flat_white", value: "Flat White", label: "Flat White" }],
      size: [{ slug: "small", value: "small", label: "Small" }],
      milk: [{ slug: "oat", value: "Oat", label: "Oat" }],
      strength: [{ slug: "mild", value: "mild", label: "Mild" }],
      addon: [{ slug: "butter_croissant", value: "butter_croissant", label: "Butter Croissant" }],
    };
    const options = mappableOptionsFrom(groups);
    expect(options.map((o) => o.category)).toEqual(["drink", "milk", "addon"]);
    expect(options.map((o) => o.slug)).toEqual(["flat_white", "oat", "butter_croissant"]);
  });
});
