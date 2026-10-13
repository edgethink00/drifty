import { describe, expect, it } from "vitest";
import type { ActivityCategory, ActivitySegment } from "@drifty/domain";
import { daySpansFromSegments } from "./DayRecordPage";

function segment(startedAt: string, endedAt: string, category: ActivityCategory, productivity: "focus" | "drift" | "neutral", extra: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id: startedAt + "-" + category, startedAt, endedAt,
    durationSeconds: (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    appName: "Fixture", windowTitle: "", platform: "macos", source: "nsworkspace",
    classification: { category, productivity, source: "manual", confidence: 1, reason: "fixture" },
    ...extra,
  };
}

describe("daily record spans from this Mac's records", () => {
  it("clips to the app's 04:00 day and keeps minutes after the day's midnight, past midnight included", () => {
    const spans = daySpansFromSegments([
      segment("2026-10-12T03:00:00", "2026-10-12T05:00:00", "workspace", "focus"),
      segment("2026-10-13T01:00:00", "2026-10-13T06:00:00", "workspace", "focus"),
    ], "2026-10-12", 240);
    expect(spans.map((span) => [span.start, span.end])).toEqual([[240, 300], [1500, 1680]]);
  });

  it("uses the board's category names and keeps app, bundle and site for the hover card", () => {
    const [span] = daySpansFromSegments([
      segment("2026-10-12T10:00:00", "2026-10-12T10:30:00", "social_media", "drift", { appName: "Safari", bundleId: "com.apple.Safari", siteDomain: "x.com" }),
    ], "2026-10-12", 240);
    expect(span).toEqual({ start: 600, end: 630, kind: "drift", category: "socialMedia", app: "Safari", bundleId: "com.apple.Safari", site: "x.com" });
  });

  it("drops records outside the day", () => {
    expect(daySpansFromSegments([segment("2026-10-11T10:00:00", "2026-10-11T11:00:00", "workspace", "focus")], "2026-10-12", 240)).toEqual([]);
  });
});
