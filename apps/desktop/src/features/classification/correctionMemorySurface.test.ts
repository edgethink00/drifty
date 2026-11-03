import { describe, expect, it } from "vitest";
import type { LivingSoulPromptContext } from "@drifty/domain";

import {
  correctionMemorySummary,
  correctionMemorySurfaceName,
  correctionMemorySurfaceOfSummary,
  correctionMemorySurfacesForSegments,
  scopeSoulToCorrectionSurfaces,
} from "./correctionMemorySurface";

const pattern = (summary: string) => ({ summary, confidence: "low" as const, evidenceCount: 1 });

function soulWith(): LivingSoulPromptContext {
  return {
    revision: 4,
    declared: { workActivities: [], workDomain: null, workDescription: "Founder of a tracker app.", purpose: null },
    learnedWorkSupport: [
      pattern(correctionMemorySummary("Slack", "focus", false)),
      pattern("Lab chats about experiments support research work."),
    ],
    learnedDrift: [pattern(correctionMemorySummary("Photos", "drift", false))],
    ambiguities: [pattern(correctionMemorySummary("youtube.com", "neutral", false))],
  };
}

describe("deterministic correction memory surfaces", () => {
  it("reads back the app or site of every deterministic sentence", () => {
    expect(correctionMemorySurfaceOfSummary(correctionMemorySummary("Slack", "focus", false))).toBe("Slack");
    expect(correctionMemorySurfaceOfSummary(correctionMemorySummary("Slack", "focus", true))).toBe("Slack");
    expect(correctionMemorySurfaceOfSummary(correctionMemorySummary("Photos", "drift", false))).toBe("Photos");
    expect(correctionMemorySurfaceOfSummary(correctionMemorySummary("youtube.com", "neutral", false))).toBe("youtube.com");
    expect(correctionMemorySurfaceOfSummary("Lab chats about experiments support research work.")).toBeNull();
    expect(correctionMemorySurfaceOfSummary("Using [private context] can support work when surrounding intent supports it.")).toBeNull();
  });

  it("names a site before its browser and cleans the name like the stored sentence", () => {
    expect(correctionMemorySurfaceName({ appName: "Google Chrome", siteDomain: "youtube.com" })).toBe("youtube.com");
    expect(correctionMemorySurfaceName({ appName: " Slack <beta>\n", siteDomain: null })).toBe("Slack beta");
    expect(correctionMemorySurfacesForSegments([
      { id: "a", appName: "Slack" },
      { id: "b", appName: "Google Chrome", siteDomain: "YouTube.com" },
    ])).toEqual({ a: "Slack", b: "YouTube.com" });
  });

  it("sends a deterministic sentence only with requests about its own app or site", () => {
    const soul = soulWith();
    const surfaces = { slack: "Slack", tube: "YouTube.com", notes: "Notes" };

    const forSlack = scopeSoulToCorrectionSurfaces(soul, surfaces, ["slack"]);
    expect(forSlack?.learnedWorkSupport.map((p) => p.summary)).toEqual(soul.learnedWorkSupport.map((p) => p.summary));
    expect(forSlack?.learnedDrift).toEqual([]);
    expect(forSlack?.ambiguities).toEqual([]);

    const forNotes = scopeSoulToCorrectionSurfaces(soul, surfaces, ["notes"]);
    expect(forNotes?.learnedWorkSupport.map((p) => p.summary)).toEqual(["Lab chats about experiments support research work."]);
    expect(forNotes?.declared).toEqual(soul.declared);
    expect(forNotes?.revision).toBe(4);

    const batch = scopeSoulToCorrectionSurfaces(soul, surfaces, ["notes", "tube"]);
    expect(batch?.ambiguities).toEqual(soul.ambiguities);
    expect(batch?.learnedDrift).toEqual([]);
  });

  it("leaves the Soul unchanged without a surface map", () => {
    const soul = soulWith();
    expect(scopeSoulToCorrectionSurfaces(soul, undefined, ["anything"])).toBe(soul);
    expect(scopeSoulToCorrectionSurfaces(null, { a: "Slack" }, ["a"])).toBeNull();
  });
});
