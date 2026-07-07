import { describe, expect, it } from "vitest";
import {
  buildProjectPassPrompt,
  compactActivityRuns,
  PROJECT_PASS_PROMPT_VERSION,
  summarizeProjectPassChunk,
  type ActivitySegment,
  type ProjectPassPromptProject,
} from "@drifty/domain";

function seg(
  fields: Pick<ActivitySegment, "id" | "startedAt" | "endedAt" | "durationSeconds" | "appName"> &
    Partial<ActivitySegment>,
): ActivitySegment {
  return { platform: "macos", source: "accessibility", ...fields };
}

const runs = compactActivityRuns([
  seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:40:00+00:00", durationSeconds: 2400, appName: "Code", classification: { category: "workspace", productivity: "focus", source: "llm", confidence: 0.9 } }),
  seg({ id: "2", startedAt: "2026-04-06T10:00:00+00:00", endedAt: "2026-04-06T10:15:00+00:00", durationSeconds: 900, appName: "Chrome", siteDomain: "youtube.com", youtubeIsShorts: true, classification: { category: "entertainment", productivity: "drift", source: "llm", confidence: 0.8 } }),
]);

const project: ProjectPassPromptProject = {
  id: "p1",
  name: "Drifty",
  description: "Mac app development",
  anchors: [
    { kind: "app", value: "Code", source: "harvested" },
    { kind: "domain", value: "github.com", source: "manual" },
  ],
  exemplars: ["r7 | 11:00–11:30 (30m) | Code · github.com | current: workspace/focus (manual)"],
};

describe("buildProjectPassPrompt", () => {
  it("has a stable version tag", () => {
    expect(PROJECT_PASS_PROMPT_VERSION).toBe("pp-v1");
  });

  it("lists projects with signals and exemplars, and renders run lines", () => {
    const prompt = buildProjectPassPrompt({ runs, workProfile: "iOS developer", projects: [project] });
    expect(prompt).toContain('p1 "Drifty": Mac app development');
    expect(prompt).toContain("Known signals: apps [Code]; domains [github.com]");
    expect(prompt).toContain("Confirmed examples:");
    expect(prompt).toContain("r0 | 09:00–09:40 (40m) | Code | current: workspace/focus (llm)");
    expect(prompt).toContain("User work profile: iOS developer");
    expect(prompt).toContain('Return JSON only');
    expect(prompt).toContain('"assignments"');
    expect(prompt).toContain('"corrections"');
  });

  it("degrades gracefully with no projects defined", () => {
    const prompt = buildProjectPassPrompt({ runs, workProfile: null, projects: [] });
    expect(prompt).toContain("(none defined");
    expect(prompt).toContain("User work profile: (not provided)");
  });

  it("includes the previous chunk summary when present", () => {
    const prompt = buildProjectPassPrompt({ runs, workProfile: null, projects: [project], previousChunkSummary: "Morning was all coding." });
    expect(prompt).toContain("Previous chunk summary (context only): Morning was all coding.");
  });

  it("says none when no previous chunk summary", () => {
    const prompt = buildProjectPassPrompt({ runs, workProfile: null, projects: [project] });
    expect(prompt).toContain("Previous chunk summary (context only): none");
  });
});

describe("summarizeProjectPassChunk", () => {
  it("pairs tail runs with their assigned project name, or 'no project'", () => {
    const summary = summarizeProjectPassChunk(
      runs,
      new Map([
        ["r0", "p1"],
        ["r1", null],
      ]),
      new Map([["p1", "Drifty"]]),
    );
    expect(summary).toContain("Code | current: workspace/focus (llm) -> Drifty");
    expect(summary).toContain("-> no project");
  });

  it("returns 'none' for an empty chunk", () => {
    expect(summarizeProjectPassChunk([], new Map(), new Map())).toBe("none");
  });
});
