import { buildEffectiveProductivityDurations, buildProductivityDurations, type ActivityCategory, type ActivitySegment, type ProductivityLabel } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildWeeklyBreakdown } from "../insights/insightData";
import { buildShareCardData } from "../share/shareCard";

function mixedDirectAndContextualSegments(): ActivitySegment[] {
  return [
    segment("focus-before", "2026-06-12T10:00:00", "2026-06-12T10:20:00", "Code", "workspace", "focus"),
    segment("utility-finder", "2026-06-12T10:20:00", "2026-06-12T10:21:00", "Finder", "utility", "neutral"),
    segment("focus-mid", "2026-06-12T10:21:00", "2026-06-12T10:41:00", "Code", "workspace", "focus"),
    segment("slack-context", "2026-06-12T10:41:00", "2026-06-12T10:47:00", "Slack", "communication", "neutral"),
    segment("focus-after", "2026-06-12T10:47:00", "2026-06-12T10:57:00", "Code", "workspace", "focus"),
  ];
}

function segment(
  id: string,
  startedAt: string,
  endedAt: string,
  appName: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
): ActivitySegment {
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
    appName,
    bundleId: appName === "Slack" ? "com.tinyspeck.slackmacgap" : "com.example.code",
    windowTitle: id,
    platform: "macos",
    source: "nsworkspace",
    classification: {
      category,
      productivity,
      source: "manual",
      confidence: 1,
      reason: "focus-hours-contract",
    },
  };
}

function secondsFor(totals: ReturnType<typeof buildProductivityDurations>, productivity: ProductivityLabel): number {
  return totals.find((entry) => entry.productivity === productivity)?.totalSeconds ?? 0;
}

describe("canonical Focus hours", () => {
  it("keeps mixed utility and communication on the direct classified total", () => {
    const segments = mixedDirectAndContextualSegments();
    const direct = buildProductivityDurations(segments);
    const effective = buildEffectiveProductivityDurations(segments);

    expect(secondsFor(direct, "focus")).toBe(50 * 60);
    expect(secondsFor(direct, "neutral")).toBe(7 * 60);
    expect(secondsFor(effective, "focus")).toBe(57 * 60);
    expect(secondsFor(effective, "neutral")).toBe(0);

    const weekly = buildWeeklyBreakdown(segments);
    const friday = weekly.find((day) => day.weekday === "Fri");
    expect(friday?.focusSeconds).toBe(50 * 60);
    expect(friday?.neutralSeconds).toBe(7 * 60);

    const share = buildShareCardData({
      language: "en",
      day: "2026-06-12",
      totalSeconds: 57 * 60,
      categoryTotals: [],
      productivityTotals: direct,
      flowBlocks: [],
      deltaSeconds: null,
    });
    expect(share.focusSeconds).toBe(50 * 60);
    expect(share.focusSeconds).not.toBe(secondsFor(effective, "focus"));
  });
});
