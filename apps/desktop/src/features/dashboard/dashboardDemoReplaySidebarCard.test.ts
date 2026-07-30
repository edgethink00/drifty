import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildSelectedDashboardReplayAnchor } from "./dashboardDemoReplaySource";
import type { DashboardDemoReplayActiveState } from "./useDashboardDemoReplayController";
import { buildDashboardDemoReplaySidebarCard } from "./dashboardDemoReplaySidebarCard";

const SOURCE_SEGMENT: ActivitySegment = {
  id: "source-focus",
  startedAt: "2026-06-20T09:00:00",
  endedAt: "2026-06-20T09:30:00",
  durationSeconds: 30 * 60,
  appName: "Focus Studio",
  bundleId: "com.example.focus",
  windowTitle: "Focus work",
  platform: "macos",
  source: "manual",
};

function buildReplayState(): DashboardDemoReplayActiveState {
  const anchor = buildSelectedDashboardReplayAnchor({
    kind: "day",
    anchorDay: "2026-06-20",
    startDay: "2026-06-20",
    endDay: "2026-06-20",
    startOfDayMinutes: 240,
  });

  return {
    kind: "active",
    anchor,
    fixture: {
      kind: "day",
      anchor,
      segments: [SOURCE_SEGMENT],
      totalSeconds: SOURCE_SEGMENT.durationSeconds,
    },
    phase: "playing",
    playingStartedAtMs: 0,
    progress: 0,
    replayKind: "day",
    runId: 1,
    settings: { preRollSeconds: 0, durationSeconds: 15 },
  };
}

describe("buildDashboardDemoReplaySidebarCard", () => {
  it("uses actual replay source activity when the visible replay slice is still empty", () => {
    // Given
    const replayState = buildReplayState();

    // When
    const card = buildDashboardDemoReplaySidebarCard({
      currentDay: "2026-06-20",
      currentMinuteOfDay: 9 * 60,
      replayState,
      segments: [],
      startOfDayMinutes: 240,
    });

    // Then
    expect(card?.statusLabel).toBe("Replaying day");
    expect(card?.durationLabel).toBe("0m");
    expect(card?.appLabel).toBe("Focus Studio");
    expect(card?.metaLabel).toBe("Replay time: 9:00 AM");
    expect(card?.actionLabel).toBe("Stop replay");
  });

  it("uses the replay clock minute as wall-clock time instead of logical-day offset", () => {
    // Given
    const replayState = buildReplayState();

    // When
    const card = buildDashboardDemoReplaySidebarCard({
      currentDay: "2026-06-20",
      currentMinuteOfDay: 5 * 60,
      replayState,
      segments: [],
      startOfDayMinutes: 240,
    });

    // Then
    expect(card?.appLabel).toBe("Focus Studio");
    expect(card?.metaLabel).toBe("Replay time: 5:00 AM");
  });
});
