import { describe, expect, it } from "vitest";

import type {
  ActivitySegment,
  RecentEpisodePromptContext,
} from "@drifty/domain";

import {
  contextualPriorPromptPatterns,
  livingSoulPromptContext,
  mergeLivingSoulPassiveEvidence,
  type LivingSoulDocument,
  type LivingSoulResolvedContext,
} from "./livingSoul";
import {
  communicationSelectorHashes,
  isIndependentPassiveWorkAnchor,
  soulPromptContextForEpisodes,
  soulPromptContextForRequest,
} from "./passiveSoulLearning";

const episode: RecentEpisodePromptContext = {
  windowMinutes: 30,
  observedMinutes: 8,
  dominantSurface: "Cursor",
  currentSurfaceSeconds: 300,
  transitions: [
    { appName: "Messages", title: "Jordan", durationSeconds: 120 },
    { appName: "Cursor", title: "Drifty launch", durationSeconds: 360 },
  ],
};

describe("passive Soul learning", () => {
  it("derives a stable private selector only from a preceding communication title", async () => {
    const first = await communicationSelectorHashes(episode);
    const second = await communicationSelectorHashes(episode);
    expect(first).toHaveLength(1);
    expect(first).toEqual(second);
    expect(first[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(first[0]).not.toContain("jordan");
    expect(await communicationSelectorHashes({
      ...episode,
      transitions: [{ appName: "Messages", durationSeconds: 120 }, episode.transitions[1]],
    })).toEqual([]);
  });

  it("uses only independent manual/rule or high-precision registry work anchors", () => {
    expect(isIndependentPassiveWorkAnchor(segment({ appName: "Cursor" }))).toBe(true);
    expect(isIndependentPassiveWorkAnchor(segment({
      appName: "Google Chrome",
      siteDomain: "unknown.example",
      classification: { category: "workspace", productivity: "focus", source: "llm", confidence: 0.99 },
    }))).toBe(false);
    expect(isIndependentPassiveWorkAnchor(segment({
      appName: "Google Chrome",
      siteDomain: "instagram.com",
    }))).toBe(false);
    expect(isIndependentPassiveWorkAnchor(segment({
      appName: "Google Chrome",
      siteDomain: "instagram.com",
      classification: { category: "social_media", productivity: "focus", source: "manual", confidence: 1 },
    }))).toBe(true);
  });

  it("keeps one-day repetition as a candidate and promotes only across three distinct days", async () => {
    const [selectorHash] = await communicationSelectorHashes(episode);
    let priors = mergeLivingSoulPassiveEvidence([], [selectorHash], "2026-08-10T09:00:00.000Z");
    priors = mergeLivingSoulPassiveEvidence(priors, [selectorHash], "2026-08-10T10:00:00.000Z");
    expect(priors[0].observedDays).toEqual(["2026-08-10"]);
    expect(contextualPriorPromptPatterns(document(priors), [selectorHash], Date.parse("2026-08-10T12:00:00.000Z"))).toEqual([]);

    priors = mergeLivingSoulPassiveEvidence(priors, [selectorHash], "2026-08-11T09:00:00.000Z");
    priors = mergeLivingSoulPassiveEvidence(priors, [selectorHash], "2026-08-12T09:00:00.000Z");
    expect(contextualPriorPromptPatterns(
      document(priors),
      [selectorHash],
      Date.parse("2026-08-12T12:00:00.000Z"),
    )).toEqual([{
      summary: expect.stringContaining("communication selector"),
      confidence: "low",
      evidenceCount: 3,
    }]);
  });

  it("retrieves a promoted prior only when the matching context is present", async () => {
    const [selectorHash] = await communicationSelectorHashes(episode);
    const soulDocument = document([{
      selectorHash,
      observedDays: ["2026-08-10", "2026-08-11", "2026-08-12"],
      lastObservedAt: "2026-08-12T09:00:00.000Z",
      summary: "A recurring communication context visible in the recent Episode has repeatedly preceded independently anchored work activity.",
    }]);
    const soul: LivingSoulResolvedContext = {
      ownerId: "local",
      scope: "a".repeat(64),
      document: soulDocument,
      promptContext: livingSoulPromptContext(soulDocument),
    };
    const matched = await soulPromptContextForEpisodes(
      soul,
      [episode],
      Date.parse("2026-08-12T12:00:00.000Z"),
    );
    const unrelated = await soulPromptContextForEpisodes(
      soul,
      [{ ...episode, transitions: [
        { appName: "Messages", title: "Someone else", durationSeconds: 120 },
        episode.transitions[1],
      ] }],
      Date.parse("2026-08-12T12:00:00.000Z"),
    );
    expect(matched.learnedWorkSupport).toEqual([]);
    expect(matched.matchedContextualWorkSupport).toEqual([{
      summary: expect.stringContaining("For this item only"),
      confidence: "low",
      evidenceCount: 3,
    }]);
    expect(unrelated.matchedContextualWorkSupport).toBeUndefined();
  });

  it("expires a promoted prior at retrieval time after ninety inactive days", async () => {
    const [selectorHash] = await communicationSelectorHashes(episode);
    expect(contextualPriorPromptPatterns(
      document([{
        selectorHash,
        observedDays: ["2026-01-01", "2026-01-02", "2026-01-03"],
        lastObservedAt: "2026-01-03T09:00:00.000Z",
        summary: "A recurring communication context visible in the recent Episode has repeatedly preceded independently anchored work activity.",
      }]),
      [selectorHash],
      Date.parse("2026-04-04T09:00:01.000Z"),
    )).toEqual([]);
  });

  it("does not use observations that occur after the item being classified", async () => {
    const [selectorHash] = await communicationSelectorHashes(episode);
    const prior = {
      selectorHash,
      observedDays: ["2026-08-10", "2026-08-11", "2026-08-13", "2026-08-14", "2026-08-15"],
      lastObservedAt: "2026-08-15T09:00:00.000Z",
      summary: "Stored passive association",
    };
    expect(contextualPriorPromptPatterns(
      document([prior]),
      [selectorHash],
      Date.parse("2026-08-12T12:00:00.000Z"),
    )).toEqual([]);
    expect(contextualPriorPromptPatterns(
      document([prior]),
      [selectorHash],
      Date.parse("2026-08-13T12:00:00.000Z"),
    )).toEqual([expect.objectContaining({ confidence: "low", evidenceCount: 3 })]);
  });

  it("does not inject an item-matched prior into a shared batch Soul", async () => {
    const [selectorHash] = await communicationSelectorHashes(episode);
    const soulDocument = document([{
      selectorHash,
      observedDays: ["2026-08-10", "2026-08-11", "2026-08-12"],
      lastObservedAt: "2026-08-12T09:00:00.000Z",
      summary: "A recurring communication context visible in the recent Episode has repeatedly preceded independently anchored work activity.",
    }]);
    const soul: LivingSoulResolvedContext = {
      ownerId: "local",
      scope: "a".repeat(64),
      document: soulDocument,
      promptContext: livingSoulPromptContext(soulDocument),
    };
    const prompt = await soulPromptContextForRequest(soul, {
      matched: episode,
      unrelated: {
        ...episode,
        transitions: [{ appName: "Safari", domain: "example.com", durationSeconds: 30 }],
      },
    }, Date.parse("2026-08-12T12:00:00.000Z"));
    expect(prompt).toBe(soul.promptContext);
    expect(prompt.learnedWorkSupport).toEqual([]);
    expect(prompt.matchedContextualWorkSupport).toBeUndefined();
  });
});

function document(contextualPriors: LivingSoulDocument["contextualPriors"]): LivingSoulDocument {
  return {
    schema: "drifty.soul/v1",
    revision: 1,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-12T09:00:00.000Z",
    lastFeedbackAt: null,
    declared: { workActivities: ["Product"], workDomain: "Productivity", purpose: "Protect focus" },
    learned: { workSupport: [], drift: [], ambiguities: [] },
    contextualPriors,
  };
}

function segment(overrides: Partial<ActivitySegment>): ActivitySegment {
  return {
    id: "segment",
    startedAt: "2026-08-12T09:00:00.000Z",
    endedAt: "2026-08-12T09:05:00.000Z",
    durationSeconds: 300,
    appName: "Unknown",
    platform: "macos",
    source: "manual",
    ...overrides,
  };
}
