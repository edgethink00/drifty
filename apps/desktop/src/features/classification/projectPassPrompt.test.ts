import { describe, expect, it } from "vitest";
import {
  buildProjectPassAnalysisWindows,
  buildProjectPassPrompt,
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

const windows = buildProjectPassAnalysisWindows([
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
};

describe("buildProjectPassPrompt", () => {
  it("has a stable version tag", () => {
    expect(PROJECT_PASS_PROMPT_VERSION).toBe("pp-v3");
  });

  it("separates context windows from core windows and restricts output to core ids", () => {
    const prompt = buildProjectPassPrompt({
      beforeContextWindows: [windows[0]].filter((window) => window !== undefined),
      coreWindows: [windows[1]].filter((window) => window !== undefined),
      afterContextWindows: [],
      workProfile: "iOS developer",
      projects: [project],
    });
    expect(prompt).toContain('p1 "Drifty": Mac app development');
    expect(prompt).toContain("Known signals: apps [Code]; domains [github.com]");
    expect(prompt).toContain("Context before (read-only; do not output these ids):");
    expect(prompt).toContain("Core analysis windows (return assignments and corrections only for these ids):");
    expect(prompt).toContain("Context after (read-only; do not output these ids):");
    expect(prompt).toContain("w0 |");
    expect(prompt).toContain("w1 |");
    expect(prompt).toContain("User work profile: iOS developer");
    expect(prompt).toContain('Return JSON only');
    expect(prompt).toContain('"assignments"');
    expect(prompt).toContain('"corrections"');
    expect(prompt).toContain("Ignore surrounding context ids in the output.");
  });

  it("degrades gracefully with no projects defined", () => {
    const prompt = buildProjectPassPrompt({ beforeContextWindows: [], coreWindows: windows, afterContextWindows: [], workProfile: null, projects: [] });
    expect(prompt).toContain("(none defined");
    expect(prompt).toContain("User work profile: (not provided)");
  });
});

describe("summarizeProjectPassChunk", () => {
  it("pairs tail windows with their assigned project name, or 'no project'", () => {
    const summary = summarizeProjectPassChunk(
      windows,
      new Map([
        ["w0", "p1"],
        ["w1", null],
      ]),
      new Map([["p1", "Drifty"]]),
    );
    expect(summary).toContain("dominant: Code (40m)");
    expect(summary).toContain("-> Drifty");
    expect(summary).toContain("-> no project");
  });

  it("returns 'none' for an empty chunk", () => {
    expect(summarizeProjectPassChunk([], new Map(), new Map())).toBe("none");
  });
});
