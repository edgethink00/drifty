import { describe, expect, it } from "vitest";
import type { LiveClassificationMemoryContext } from "@drifty/domain";

import { memoryContextForItems } from "./classificationMemoryContext";

function largeMemoryContext(itemCount: number): LiveClassificationMemoryContext {
  return {
    soul: {
      revision: 3,
      declared: { workActivities: ["Engineering", "Marketing"], workDomain: "AI productivity", purpose: "Protect focus" },
      learnedWorkSupport: Array.from({ length: 6 }, (_, index) => ({ summary: `Work support pattern ${index} ${"가".repeat(120)}`, confidence: "medium" as const, evidenceCount: 2 })),
      learnedDrift: [],
      ambiguities: [],
    },
    episodeByItemId: Object.fromEntries(Array.from({ length: itemCount }, (_, itemIndex) => [
      `item-${itemIndex}`,
      {
        windowMinutes: 30,
        observedMinutes: 20,
        dominantSurface: `surface-${itemIndex}.${"도메인".repeat(30)}`,
        currentSurfaceSeconds: 300,
        transitions: Array.from({ length: 8 }, (_, transitionIndex) => ({
          appName: `Browser ${transitionIndex} ${"앱".repeat(40)}`,
          domain: `example-${transitionIndex}.${"도메인".repeat(30)}`,
          title: `Private title ${"제목".repeat(60)}`,
          durationSeconds: 60,
        })),
      },
    ])),
  };
}

describe("classification memory request bounds", () => {
  it("keeps the full Episode for a live one-item classification", () => {
    const context = largeMemoryContext(1);
    const selected = memoryContextForItems(context, ["item-0"]);

    expect(selected.episodeByItemId["item-0"].transitions).toHaveLength(8);
    expect(selected.episodeByItemId["item-0"].transitions[0].title).toContain("Private title");
  });

  it("compacts a 20-item batch context below twelve UTF-8 kilobytes without dropping item ids", () => {
    const context = largeMemoryContext(20);
    const itemIds = Array.from({ length: 20 }, (_, index) => `item-${index}`);
    const selected = memoryContextForItems(context, itemIds);
    const bytes = new TextEncoder().encode(JSON.stringify(selected)).byteLength;

    expect(Object.keys(selected.episodeByItemId)).toEqual(itemIds);
    expect(bytes).toBeLessThanOrEqual(12_000);
    expect(Object.values(selected.episodeByItemId).every((episode) => episode.transitions.length <= 2)).toBe(true);
  });

  it("can shed optional context to honor a smaller enclosing request budget", () => {
    const context = largeMemoryContext(20);
    const itemIds = Array.from({ length: 20 }, (_, index) => `item-${index}`);
    const selected = memoryContextForItems(context, itemIds, 600);

    expect(new TextEncoder().encode(JSON.stringify(selected)).byteLength).toBeLessThanOrEqual(600);
  });
});
