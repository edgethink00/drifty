import { describe, expect, it } from "vitest";
import type { ActivitySegment, ProjectWindowAssignmentRecord } from "@drifty/domain";

import { averageBeforeLatest, buildSessions, sessionEvidence, sessionHeadline, titleOf } from "./projectDetailModel";

function seg(id: string, startedAt: string, durationSeconds: number, extra: Partial<ActivitySegment> = {}): ActivitySegment {
  const endedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();
  return { id, startedAt, endedAt, durationSeconds, appName: "Safari", ...extra } as ActivitySegment;
}

describe("project detail model", () => {
  it("names a record by its page or window title without the app's own suffix", () => {
    expect(titleOf(seg("a", "2026-07-10T09:00:00", 60, { siteDomain: "github.com", siteTitle: "Pull request #12", windowTitle: "Pull request #12 — Safari" }))).toBe("Pull request #12");
    expect(titleOf(seg("b", "2026-07-10T09:00:00", 60, { appName: "Figma", windowTitle: "Onboarding — Figma" }))).toBe("Onboarding");
    // A window named only after its app, or no title at all, names nothing.
    expect(titleOf(seg("c", "2026-07-10T09:00:00", 60, { appName: "Slack", windowTitle: "Slack" }))).toBeNull();
    expect(titleOf(seg("d", "2026-07-10T09:00:00", 60))).toBeNull();
  });

  it("starts a new session after a pause longer than twenty minutes or on a new day", () => {
    const sessions = buildSessions([
      seg("a", "2026-07-10T09:00:00", 600),
      seg("b", "2026-07-10T09:25:00", 600), // 15 minutes after a: same session
      seg("c", "2026-07-10T10:00:00", 600), // 25 minutes after b: a new one
      seg("d", "2026-07-11T10:05:00", 600),
    ]);
    expect(sessions.map((session) => session.segments.map((segment) => segment.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("names an untitled session by its apps and sites instead of repeating one app", () => {
    const [session] = buildSessions([
      seg("a", "2026-07-10T09:00:00", 900, { appName: "Mail" }),
      seg("b", "2026-07-10T09:15:00", 600, { appName: "Slack" }),
      seg("c", "2026-07-10T09:25:00", 300, { appName: "Mail" }),
    ]);
    expect(sessionHeadline(session!)).toEqual({ lead: "Mail", more: ["Slack"] });
  });

  it("separates time the user assigned by hand from AI window matches on the original records", () => {
    const slices = [
      seg("slice-1", "2026-07-10T09:00:00", 1200),
      seg("slice-2", "2026-07-10T09:20:00", 600),
      seg("slice-3", "2026-07-10T09:30:00", 600),
    ];
    const window = (id: string, from: string, to: string, segmentId: string, confidence: number, reason: string, stale = false): ProjectWindowAssignmentRecord => ({
      windowId: id,
      windowStartedAt: new Date(from).toISOString(),
      windowEndedAt: new Date(to).toISOString(),
      durationSeconds: 1800,
      segmentOverlaps: [{ segmentId, durationSeconds: 600 }],
      projectId: "p1",
      teamProjectId: null,
      source: "ai",
      confidence,
      reason,
      stale,
    } as ProjectWindowAssignmentRecord);
    const evidence = sessionEvidence(slices, {
      assignments: [{ segmentId: "rec-3", projectId: "p1", source: "manual" }],
      windowAssignments: [
        window("w1", "2026-07-10T09:00:00", "2026-07-10T09:30:00", "rec-1", 0.9, "Writes the release notes"),
        window("w-old", "2026-07-10T09:00:00", "2026-07-10T09:30:00", "rec-1", 0.1, "Superseded", true),
      ],
      sourceSegmentIdBySliceId: new Map([["slice-1", "rec-1"], ["slice-2", "rec-1"], ["slice-3", "rec-3"]]),
    });
    expect(evidence).toEqual({ manualSeconds: 600, aiSeconds: 1800, confidence: 0.9, reason: "Writes the release notes" });
  });

  it("averages the recent trend from the first week with any record", () => {
    const week = (seconds: number) => ({ startDay: "", endDay: "", seconds });
    expect(averageBeforeLatest([week(0), week(0), week(3600), week(0), week(1800)])).toBe(1800);
    expect(averageBeforeLatest([week(0), week(0), week(1800)])).toBeNull();
  });
});
