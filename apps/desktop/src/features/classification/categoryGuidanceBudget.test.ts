import { describe, expect, it } from "vitest";
import type { LiveCategoryGuidance } from "@drifty/domain";
import { compactCategoryGuidanceDescriptions, hasLongerCategoryDescriptions } from "./categoryGuidanceBudget";

describe("category guidance context budget compaction", () => {
  const guidance: LiveCategoryGuidance[] = [
    { category: "workspace", name: "Deep work", description: "a".repeat(300) },
    { productivity: "drift", description: "short" },
    { category: "game", removed: true },
    { category: "custom-cap00001", name: "Client calls", description: "b".repeat(200), added: true },
  ];

  it("shortens only descriptions longer than the limit and keeps names, ids and removals", () => {
    const compacted = compactCategoryGuidanceDescriptions(guidance, 120);
    expect(compacted[0]).toEqual({ category: "workspace", name: "Deep work", description: "a".repeat(120) });
    expect(compacted[1]).toBe(guidance[1]);
    expect(compacted[2]).toBe(guidance[2]);
    expect(compacted[3]).toEqual({ category: "custom-cap00001", name: "Client calls", description: "b".repeat(120), added: true });
  });

  it("reports whether a limit would change anything", () => {
    expect(hasLongerCategoryDescriptions(guidance, 120)).toBe(true);
    expect(hasLongerCategoryDescriptions(compactCategoryGuidanceDescriptions(guidance, 40), 40)).toBe(false);
    expect(hasLongerCategoryDescriptions(undefined, 40)).toBe(false);
  });
});
