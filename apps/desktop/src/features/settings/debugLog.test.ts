import type { ActivitySegment, DriftAlarmTrayStatus } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildDebugLogPayload } from "./debugLog";

const driftAlarm: DriftAlarmTrayStatus = {
  enabled: true,
  statusLabel: "Drift alerts: Monitoring",
  lastCheckedAt: null,
  lastCheckedLabel: "Never",
  resultLabel: "No eligible drift",
  detailLabel: null,
};

function segment(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id: "segment-1",
    startedAt: "2026-06-13T15:00:00+00:00",
    endedAt: "2026-06-13T15:05:00+00:00",
    durationSeconds: 300,
    appName: "Google Chrome",
    browserName: "Google Chrome",
    platform: "macos",
    source: "accessibility",
    ...overrides,
  };
}

describe("buildDebugLogPayload", () => {
  it("keeps browser fallback diagnostics concise", () => {
    const unavailableSegment = segment({
      browserAutomationStatus: "unavailable",
      browserAutomationError: "Google Chrome reported no scriptable browser window.",
    });
    const emptyResultSegment = segment({
      id: "segment-empty",
      browserAutomationStatus: "empty_result",
      browserAutomationError: "Google Chrome returned an empty browser automation result.",
    });
    const grantedSegment = segment({
      id: "segment-2",
      siteDomain: "docs.example.test",
      siteTitle: "Docs",
      siteUrl: "https://docs.example.test/",
      siteSource: "applescript",
      browserAutomationStatus: "granted",
    });
    const accessibilitySegment = segment({
      id: "segment-ax",
      siteDomain: "ax.example.test",
      siteUrl: "https://ax.example.test/",
      siteSource: "accessibility-address-bar",
      browserAutomationStatus: "granted",
    });

    const payload = buildDebugLogPayload({
      selectedDay: "2026-06-13",
      startOfDayMinutes: 240,
      startOfWeek: "monday",
      theme: "light",
      categoryColorOverrides: {},
      appThemeColorOverrides: {},
      status: null,
      accessibilityGranted: true,
      currentSnapshot: null,
      driftAlarm,
      segments: [unavailableSegment, emptyResultSegment, grantedSegment, accessibilitySegment],
      historySegments: [],
      leaderboardSegments: [],
      error: null,
    });

    expect(payload.tracker.browserCaptureDiagnostics.today.byBrowser[0]).toMatchObject({
      browserName: "Google Chrome",
      accessibilityAddressBarFallbackSegments: 1,
      accessibilityAddressBarFallbackRatio: 0.25,
      siteSourceCounts: {
        "accessibility-address-bar": 1,
        applescript: 1,
        missing: 2,
      },
    });
    expect(payload.tracker.browserCaptureDiagnostics.today.byBrowser[0]).not.toHaveProperty("automationErrorCounts");
    expect(payload.tracker.browserCaptureDiagnostics.today.byBrowser[0]).not.toHaveProperty("automationStatusCounts");
  });
});
