import type { ActivitySegment, DriftAlarmTrayStatus } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import type { DriftAlarmDebugEvent } from "../companion/driftAlarmDebugLog";
import type { AiDebugLogInput } from "./debugLog";
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

const baseAiDebug: AiDebugLogInput = {
  route: "disabled",
  connectionStatus: {
    tone: "error",
    label: "Disconnected",
    providerLabel: "Setup needed",
  },
  cloud: {
    isSupabaseConfigured: false,
    hasRequiredAccountAuth: false,
    canUseCloudAiClassification: false,
    entitlement: null,
    entitlementLoading: false,
    entitlementError: null,
  },
  local: {
    providerLabel: "Local AI",
    providerStatus: { kind: "unconfigured" },
  },
  classification: {
    actionLoading: false,
    summary: null,
    observedFailure: false,
  },
  usage: {
    day: null,
    summary: null,
  },
};

const driftAlarmDebugEvent: DriftAlarmDebugEvent = {
  id: "2026-06-13T15:05:00.000Z:fresh_candidate_result:test",
  recordedAt: "2026-06-13T15:05:00.000Z",
  kind: "fresh_candidate_result",
  alertKey: "segment-1:2026-06-13T15:05:00+00:00",
  result: "current-window-changed",
  reason: null,
  message: null,
  segment: null,
  currentSnapshot: {
    observedAt: "2026-06-13T15:05:00.000Z",
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    browserName: "Google Chrome",
    siteDomain: "youtube.com",
    youtubeVideoId: "video-1",
    hasSiteContext: true,
    siteSource: "applescript",
    captureConfidence: 0.95,
    browserAutomationStatus: "granted",
    hasBrowserAutomationError: false,
    systemTransientActivity: null,
    source: "accessibility",
  },
  candidate: null,
  ai: null,
  delivery: null,
  trayResult: null,
  evaluation: null,
};

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
      developerDiagnostics: {
        devModeEnabled: true,
        forceChromiumAxCapture: true,
        forceChromiumAxExtremeNudge: false,
      },
      status: null,
      accessibilityGranted: true,
      currentSnapshot: null,
      driftAlarm,
      driftAlarmDebugEvents: [],
      segments: [unavailableSegment, emptyResultSegment, grantedSegment, accessibilitySegment],
      historySegments: [],
      leaderboardSegments: [],
      ai: baseAiDebug,
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
    expect(payload.settings.developerDiagnostics.forceChromiumAxCapture).toBe(true);
  });

  it("records cloud AI issue diagnostics without raw provider payloads", () => {
    const payload = buildDebugLogPayload({
      selectedDay: "2026-06-13",
      startOfDayMinutes: 240,
      startOfWeek: "monday",
      theme: "light",
      categoryColorOverrides: {},
      appThemeColorOverrides: {},
      developerDiagnostics: {
        devModeEnabled: false,
        forceChromiumAxCapture: false,
        forceChromiumAxExtremeNudge: false,
      },
      status: null,
      accessibilityGranted: true,
      currentSnapshot: null,
      driftAlarm,
      driftAlarmDebugEvents: [],
      segments: [],
      historySegments: [],
      leaderboardSegments: [],
      ai: {
        ...baseAiDebug,
        route: "cloud",
        connectionStatus: {
          tone: "error",
          label: "Issue",
          providerLabel: "Cloud AI",
        },
        cloud: {
          isSupabaseConfigured: true,
          hasRequiredAccountAuth: true,
          canUseCloudAiClassification: false,
          entitlement: {
            plan: "individual",
            status: "locked",
            canUseApp: false,
            lockedReason: "payment_required",
            trialEndsAt: null,
            currentPeriodEnd: "2026-06-20T00:00:00.000Z",
          },
          entitlementLoading: false,
          entitlementError: "Unable to check billing status.",
        },
        classification: {
          actionLoading: false,
          observedFailure: true,
          summary: {
            status: "error",
            selectedSegments: 3,
            savedRecords: 1,
            message: "AI classification failed: Google AI request failed with HTTP 502",
          },
        },
        usage: {
          day: "2026-06-13",
          summary: {
            requests: 2,
            llmRequests: 1,
            itemsRequested: 3,
            cacheHits: 0,
            cacheMisses: 3,
            errors: 1,
            quotaErrors: 0,
            configErrors: 0,
            requestErrors: 1,
            parseErrors: 0,
            schemaErrors: 0,
            lastErrorType: "request",
            lastErrorMessage: "Google AI request failed with HTTP 502",
            lastErrorStatus: 502,
            lastErrorAt: "2026-06-13T15:05:00.000Z",
            latencyMsTotal: 1200,
            averageLatencyMs: 600,
            promptTokens: 100,
            responseTokens: 20,
            totalTokens: 120,
            estimatedCostUsd: 0,
          },
        },
      },
      error: null,
    });

    expect(payload.ai).toMatchObject({
      route: "cloud",
      connection: {
        tone: "error",
        label: "Issue",
        providerLabel: "Cloud AI",
      },
      cloud: {
        isSupabaseConfigured: true,
        hasRequiredAccountAuth: true,
        canUseCloudAiClassification: false,
        entitlementLoading: false,
        entitlementError: "Unable to check billing status.",
        entitlement: {
          plan: "individual",
          status: "locked",
          canUseApp: false,
          lockedReason: "payment_required",
        },
      },
      classification: {
        actionLoading: false,
        observedFailure: true,
        summary: {
          status: "error",
          selectedSegments: 3,
          savedRecords: 1,
        },
      },
      usage: {
        day: "2026-06-13",
        summary: {
          errors: 1,
          requestErrors: 1,
          lastErrorType: "request",
          lastErrorMessage: "Google AI request failed with HTTP 502",
          lastErrorStatus: 502,
          lastErrorAt: "2026-06-13T15:05:00.000Z",
        },
      },
    });
    expect(payload.ai).not.toHaveProperty("providerPayload");
    expect(payload.ai).not.toHaveProperty("apiKey");
  });

  it("includes recent drift alarm decision diagnostics", () => {
    const payload = buildDebugLogPayload({
      selectedDay: "2026-06-13",
      startOfDayMinutes: 240,
      startOfWeek: "monday",
      theme: "light",
      categoryColorOverrides: {},
      appThemeColorOverrides: {},
      developerDiagnostics: {
        devModeEnabled: false,
        forceChromiumAxCapture: false,
        forceChromiumAxExtremeNudge: false,
      },
      status: null,
      accessibilityGranted: true,
      currentSnapshot: null,
      driftAlarm,
      driftAlarmDebugEvents: [driftAlarmDebugEvent],
      segments: [],
      historySegments: [],
      leaderboardSegments: [],
      ai: baseAiDebug,
      error: null,
    });

    expect(payload.driftAlarm.recentDebugEvents).toEqual([driftAlarmDebugEvent]);
  });
});
