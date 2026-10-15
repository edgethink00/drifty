// @vitest-environment jsdom
import { classifyActivity } from "@drifty/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  previewAppIcons,
  previewDeleteActivitySegments,
  previewDeleteProject,
  previewProjectAssignments,
  previewProjects,
  previewSaveClassifications,
  previewSaveProject,
  previewSaveProjectAssignments,
  previewTimeline,
  previewTimelineSearch,
  resetPreviewMutations,
  shouldUsePreviewData,
  shouldUseLeaderboardPreview,
} from "./previewData";

describe("previewData", () => {
  const previewHistoryRange = {
    start: "2026-01-01T00:00:00",
    end: "2026-05-08T23:59:59",
  } as const;
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    resetPreviewMutations();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("uses the Drifty preview env flag", () => {
    vi.stubEnv("VITE_DRIFTY_PREVIEW", "1");
    expect(shouldUsePreviewData()).toBe(true);
  });


  it("uses Drifty query and storage keys", () => {
    window.history.replaceState(null, "", "/?driftyPreview=1");
    expect(shouldUsePreviewData()).toBe(true);

    window.history.replaceState(null, "", "/");
    window.localStorage.setItem("drifty.preview", "1");
    expect(shouldUsePreviewData()).toBe(true);
  });

  it("does not treat the Dev layout toggle as sample leaderboard data", () => {
    window.localStorage.setItem("drifty.dev.mode", "1");
    window.localStorage.setItem("drifty.dev.leaderboardPreview", "1");
    expect(shouldUseLeaderboardPreview()).toBe(false);
  });

  it("still uses sample data for the website leaderboard preview query", () => {
    window.history.replaceState(null, "", "/?leaderboardPreview=1");
    expect(shouldUseLeaderboardPreview()).toBe(true);
  });

  it("uses varied week fixtures instead of repeating the same work blocks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T20:30:00"));

    const week = previewTimeline({
      start: "2026-05-04T00:00:00",
      end: "2026-05-08T23:59:59",
    });
    const oldRepeatedBlocks = week.filter((segment) =>
      segment.appName === "Visual Studio Code"
      && segment.startedAt.endsWith("09:05:00")
      && segment.endedAt.endsWith("11:30:00")
    );
    const weekdayPlans = new Set(
      week
        .filter((segment) => segment.appName !== "Arc")
        .map((segment) => `${segment.startedAt.slice(0, 10)}:${segment.appName}:${segment.startedAt.slice(11, 16)}-${segment.endedAt.slice(11, 16)}:${segment.windowTitle ?? ""}`),
    );

    expect(oldRepeatedBlocks.length).toBeLessThan(2);
    expect(weekdayPlans.size).toBeGreaterThan(12);
  });

  it("keeps review-only classification, project, and deletion edits in memory", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T20:30:00"));
    const query = { day: "2026-05-08" } as const;
    const segment = previewTimeline(query)[0]!;

    expect(previewProjects().map((project) => project.name)).toEqual(["Drifty", "Research", "Launch"]);
    previewSaveClassifications([{
      segmentId: segment.id,
      category: "learning",
      productivity: "focus",
      source: "manual",
      confidence: 1,
      inputFingerprint: "preview-test",
    }]);
    previewSaveProjectAssignments([{
      segmentId: segment.id,
      projectId: "preview-project-research",
      source: "manual",
    }]);

    const edited = previewTimeline(query).find((item) => item.id === segment.id)!;
    expect(edited.classification).toMatchObject({ category: "learning", productivity: "focus", source: "manual" });
    expect(previewProjectAssignments(query).find((assignment) => assignment.segmentId === segment.id)).toMatchObject({
      projectId: "preview-project-research",
      source: "manual",
    });

    expect(previewDeleteActivitySegments(["missing-preview-segment"])).toEqual({ deleted: 0 });
    expect(previewDeleteActivitySegments([segment.id, segment.id])).toEqual({ deleted: 1 });
    expect(previewTimeline(query).some((item) => item.id === segment.id)).toBe(false);

    resetPreviewMutations();
    expect(previewTimeline(query).some((item) => item.id === segment.id)).toBe(true);
    expect(previewProjectAssignments(query).find((assignment) => assignment.segmentId === segment.id)).toMatchObject({
      source: "ai",
    });
  });

  it("starts with no projects when the preview asks for none", () => {
    window.history.replaceState(null, "", "/?driftyPreview=1&previewProjects=none");
    resetPreviewMutations();
    expect(previewProjects()).toEqual([]);
    window.history.replaceState(null, "", "/");
    resetPreviewMutations();
    expect(previewProjects().map((project) => project.name)).toEqual(["Drifty", "Research", "Launch"]);
  });

  it("keeps preview project edits in memory, the way the tracker saves and deletes them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T20:30:00"));
    const query = { day: "2026-05-08" } as const;

    expect(() => previewSaveProject({ name: "  ", description: "" })).toThrow("name is required");
    const created = previewSaveProject({ name: " Q3 launch ", description: "Release prep", color: "#2f8b83" });
    expect(created).toMatchObject({ name: "Q3 launch", status: "active", color: "#2f8b83", anchors: [] });
    previewSaveProject({ id: created.id, name: "Q3 launch", description: "Release prep", color: "#2f8b83", status: "archived" });
    expect(previewProjects().map((project) => [project.name, project.status])).toEqual([
      ["Drifty", "active"], ["Research", "active"], ["Launch", "active"], ["Q3 launch", "archived"],
    ]);

    const driftyTime = previewProjectAssignments(query).filter((assignment) => assignment.projectId === "preview-project-drifty");
    expect(driftyTime.length).toBeGreaterThan(0);
    expect(previewDeleteProject("preview-project-drifty")).toEqual({ deleted: 1 });
    expect(previewDeleteProject("preview-project-drifty")).toEqual({ deleted: 0 });
    const afterDelete = new Map(previewProjectAssignments(query).map((assignment) => [assignment.segmentId, assignment.projectId]));
    for (const assignment of driftyTime) expect(afterDelete.get(assignment.segmentId)).toBeNull();

    resetPreviewMutations();
    expect(previewProjects().map((project) => project.name)).toEqual(["Drifty", "Research", "Launch"]);
  });

  it("shapes today preview as a human day: long focus streaks, varied blocks, real breaks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T20:30:00"));

    const day = previewTimeline({ day: "2026-05-08" });
    const durationsMinutes = day.map((segment) => segment.durationSeconds / 60);
    const sessionGaps = day.slice(1).filter((segment, index) =>
      Date.parse(segment.startedAt) - Date.parse(day[index]?.endedAt ?? segment.startedAt) >= 5 * 60 * 1000
    );
    const longBreak = day.slice(1).some((segment, index) =>
      Date.parse(segment.startedAt) - Date.parse(day[index]?.endedAt ?? segment.startedAt) >= 90 * 60 * 1000
    );
    const longFocusStreaks = day.filter((segment) =>
      classifyActivity(segment).productivity === "focus" && segment.durationSeconds > 30 * 60
    );
    const driftSegments = day.filter((segment) => classifyActivity(segment).productivity === "drift");
    const shortDrifts = driftSegments.filter((segment) => segment.durationSeconds <= 9 * 60);
    const mediumDrifts = driftSegments.filter((segment) => segment.durationSeconds >= 12 * 60 && segment.durationSeconds <= 20 * 60);
    const futureSegments = day.filter((segment) => segment.startedAt > "2026-05-08T20:30:00");
    const unknownClassifications = day.filter((segment) => classifyActivity(segment).category === "unknown");

    // Chunky, not a wall of 3-minute fragments.
    expect(day.length).toBeGreaterThanOrEqual(14);
    expect(day.length).toBeLessThanOrEqual(28);
    // Real deep-work streaks alongside quick context switches -> a wide duration spread.
    expect(longFocusStreaks.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...durationsMinutes)).toBeGreaterThanOrEqual(40);
    expect(Math.min(...durationsMinutes)).toBeLessThanOrEqual(10);
    // Natural breaks: several short gaps plus one long (meal) break.
    expect(sessionGaps.length).toBeGreaterThan(3);
    expect(longBreak).toBe(true);
    // Varied drift, fully classified, nothing in the future.
    expect(shortDrifts.length).toBeGreaterThanOrEqual(2);
    expect(mediumDrifts.length).toBeGreaterThanOrEqual(2);
    expect(futureSegments).toEqual([]);
    expect(unknownClassifications).toEqual([]);
  });

  it("returns real preview app icon references for native app identities", () => {
    const icons = previewAppIcons([
      { appName: "Visual Studio Code", bundleId: "com.microsoft.VSCode" },
      { appName: "Figma", bundleId: "com.figma.Desktop" },
      { appName: "Linear", bundleId: "com.linear" },
    ]);

    expect(icons["com.microsoft.VSCode"]).toContain("visual-studio-code");
    // Preview icons are bundled assets only; the webview no longer loads
    // remote favicons, so an app without a bundled asset resolves to null and
    // renders the lettered glyph.
    expect(icons.Figma).toBeNull();
    expect(icons.Linear).toContain("linear");
  });

  it("returns an empty preview search page for blank queries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T20:30:00"));

    expect(previewTimelineSearch({ query: "   ", ...previewHistoryRange, limit: 25 })).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
  });

  it("searches preview history within the explicit range with whitespace tokens across fields", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T20:30:00"));

    const page = previewTimelineSearch({ query: "arc react", ...previewHistoryRange, limit: 20 });

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((segment) => segment.appName === "Arc" && segment.siteDomain === "react.dev")).toBe(true);
    expect(page.items.some((segment) => segment.startedAt < "2026-04-01T00:00:00")).toBe(true);
  });

  it("applies optional preview search range filters", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T20:30:00"));

    const page = previewTimelineSearch({
      query: "slack",
      start: "2026-05-08T00:00:00",
      end: "2026-05-08T23:59:59",
      limit: 20,
    });

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((segment) => segment.startedAt.slice(0, 10) === "2026-05-08")).toBe(true);
    expect(page.items.every((segment) => segment.appName === "Slack")).toBe(true);
  });

  it("pages preview search results with the timeline cursor", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T20:30:00"));

    const firstPage = previewTimelineSearch({ query: "github", ...previewHistoryRange, limit: 1 });
    const secondPage = previewTimelineSearch({
      query: "github",
      ...previewHistoryRange,
      beforeEndedAt: firstPage.nextCursor?.beforeEndedAt,
      beforeSegmentId: firstPage.nextCursor?.beforeSegmentId,
      limit: 1,
    });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
  });

  it("matches preview search against classification category and productivity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T20:30:00"));

    const page = previewTimelineSearch({ query: "social_media drift", ...previewHistoryRange, limit: 50 });

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((segment) => segment.classification?.category === "social_media")).toBe(true);
    expect(page.items.every((segment) => segment.classification?.productivity === "drift")).toBe(true);
  });
});
