import type { ActivitySegment, DriftAlarmTrayStatus } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import type { DriftAlarmDebugEvent } from "../companion/driftAlarmDebugLog";
import type { ContextualGuardAuditEvent } from "../classification/contextualGuardAuditLog";
import type { AiDebugLogInput, EnhancedContextDebugEvent } from "./debugLog";
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
    memoryLabel: null,
    issueKind: null,
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
    youtubeIsShorts: null,
    youtubeUrlPathKind: "missing_url",
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
  candidateProbe: null,
};

const contextualGuardAuditEvent: ContextualGuardAuditEvent = {
  schemaVersion: 1,
  recordedAt: "2026-06-13T15:05:00.000Z",
  route: "cloud",
  outcome: "applied",
  reason: "applied",
  category: "social_media",
  rawProductivity: "drift",
  finalProductivity: "neutral",
  rawConfidence: 0.91,
  finalConfidence: 0.5,
  evidenceCount: 5,
  matchConfidence: "medium",
  soulRevision: 4,
  currentDurationBucket: "1_to_3m",
  promptVersion: "v8.2-soul-episode-v2",
};

describe("buildDebugLogPayload", () => {
  it("includes browser automation diagnostics without raw activity rows", () => {
    const unavailableSegment = segment({
      browserAutomationStatus: "unavailable",
      browserAutomationError: "Google Chrome reported no scriptable browser window.",
    });
    const emptyResultSegment = segment({
      id: "segment-empty",
      browserAutomationStatus: "empty_result",
      browserAutomationError: "Google Chrome returned an empty browser automation result.",
    });
    const deniedSegment = segment({
      id: "segment-denied",
      browserAutomationStatus: "denied",
      browserAutomationError: "Not authorized to send Apple events to Google Chrome.",
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
    const historySegment = segment({
      id: "segment-history",
      siteDomain: "docs.example.test",
      siteUrl: "https://docs.example.test/fallback",
      siteSource: "browser-history-title",
      browserAutomationStatus: "granted",
      browserHistoryStatus: "matched",
      browserHistoryReason: "matched",
      browserHistoryDatabaseFound: true,
      browserHistoryProfileCount: 1,
      browserHistoryCandidateCount: 7,
      browserHistoryErrorCount: 0,
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
        forceFrontmostFallbackCapture: true,
        forceBrowserHistoryUrlFallback: true,
        forceChromiumAxExtremeNudge: false,
      },
      status: null,
      accessibilityGranted: true,
      currentSnapshot: {
        observedAt: "2026-06-13T15:05:00.000Z",
        appName: "Google Chrome",
        browserName: "Google Chrome",
        siteSource: "browser-history-title",
        captureConfidence: 0.45,
        source: "accessibility",
        browserHistoryStatus: "matched",
        browserHistoryReason: "matched",
        browserHistoryDatabaseFound: true,
        browserHistoryProfileCount: 1,
        browserHistoryCandidateCount: 7,
        browserHistoryErrorCount: 0,
      },
      driftAlarm,
      driftAlarmDebugEvents: [],
      segments: [unavailableSegment, emptyResultSegment, deniedSegment, grantedSegment, accessibilitySegment, historySegment],
      historySegments: [],
      leaderboardSegments: [],
      ai: baseAiDebug,
      error: null,
    });

    expect(payload.tracker.browserCaptureDiagnostics.today).toMatchObject({
      browserAutomationStatusCounts: {
        unavailable: 1,
        empty_result: 1,
        denied: 1,
        granted: 3,
      },
      browserAutomationErrorCounts: {
        "Google Chrome reported no scriptable browser window.": 1,
        "Google Chrome returned an empty browser automation result.": 1,
        "Not authorized to send Apple events to Google Chrome.": 1,
      },
      browserAutomationErrorSegments: 3,
      browserAutomationDeniedSegments: 1,
      browserHistoryStatusCounts: {
        matched: 1,
        missing: 5,
      },
      browserHistoryDatabaseFoundSegments: 1,
      browserHistoryAttemptSegments: 1,
    });
    expect(payload.tracker.browserCaptureDiagnostics.today.byBrowser[0]).toMatchObject({
      browserName: "Google Chrome",
      accessibilityAddressBarFallbackSegments: 1,
      accessibilityAddressBarFallbackRatio: 0.1667,
      browserHistoryFallbackSegments: 1,
      browserHistoryFallbackRatio: 0.1667,
      siteSourceCounts: {
        "accessibility-address-bar": 1,
        applescript: 1,
        "browser-history-title": 1,
        missing: 3,
      },
      browserAutomationStatusCounts: {
        unavailable: 1,
        empty_result: 1,
        denied: 1,
        granted: 3,
      },
      browserAutomationErrorCounts: {
        "Google Chrome reported no scriptable browser window.": 1,
        "Google Chrome returned an empty browser automation result.": 1,
        "Not authorized to send Apple events to Google Chrome.": 1,
      },
      browserAutomationErrorSegments: 3,
      browserAutomationDeniedSegments: 1,
      browserHistoryStatusCounts: {
        matched: 1,
        missing: 5,
      },
      browserHistoryReasonCounts: {
        matched: 1,
      },
      browserHistoryDatabaseFoundSegments: 1,
      browserHistoryAttemptSegments: 1,
    });
    expect(payload.tracker.currentSnapshot).toMatchObject({
      browserHistoryStatus: "matched",
      browserHistoryReason: "matched",
      browserHistoryDatabaseFound: true,
      browserHistoryProfileCount: 1,
      browserHistoryCandidateCount: 7,
      browserHistoryErrorCount: 0,
    });
    expect(payload.tracker.browserHistoryFallback).toMatchObject({
      status: "matched",
      reason: "matched",
      databaseFound: true,
      profileCount: 1,
      candidateCount: 7,
      errorCount: 0,
    });
    expect(payload.tracker.browserCaptureDiagnostics.today.byBrowser[0]).not.toHaveProperty("segments");
    expect(payload.tracker.browserCaptureDiagnostics.today.byBrowser[0]).not.toHaveProperty("rawActivityRows");
    expect(payload.settings.developerDiagnostics.forceChromiumAxCapture).toBe(true);
    expect(payload.settings.developerDiagnostics.forceFrontmostFallbackCapture).toBe(true);
    expect(payload.settings.developerDiagnostics.forceBrowserHistoryUrlFallback).toBe(true);
  });

  it("summarizes frontmost app capture diagnostics for unavailable history", () => {
    const unavailableSegment = segment({
      appName: "Unavailable",
      browserName: null,
      durationSeconds: 120,
      source: "nsworkspace",
      frontmostCaptureSource: "unavailable",
      frontmostCaptureError: "osascript timed out",
      frontmostFallbackError: "lsappinfo info returned no parseable app name.",
    });
    const fallbackSegment = segment({
      id: "fallback-segment",
      appName: "Notes",
      browserName: null,
      bundleId: "com.apple.Notes",
      durationSeconds: 30,
      frontmostCaptureSource: "lsappinfo",
      frontmostCaptureError: "System Events lookup failed",
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
        forceChromiumAxCapture: false,
        forceFrontmostFallbackCapture: true,
        forceBrowserHistoryUrlFallback: false,
        forceChromiumAxExtremeNudge: true,
      },
      status: null,
      accessibilityGranted: true,
      currentSnapshot: {
        observedAt: "2026-06-13T15:05:00.000Z",
        appName: "Unavailable",
        source: "nsworkspace",
        frontmostCaptureSource: "unavailable",
        frontmostCaptureError: "osascript timed out",
        frontmostFallbackError: "lsappinfo info returned no parseable app name.",
      },
      driftAlarm,
      driftAlarmDebugEvents: [],
      segments: [unavailableSegment, fallbackSegment],
      historySegments: [],
      leaderboardSegments: [],
      ai: baseAiDebug,
      error: null,
    });

    expect(payload.tracker.currentSnapshot).toMatchObject({
      appName: "Unavailable",
      frontmostCaptureSource: "unavailable",
      frontmostCaptureError: "osascript timed out",
      frontmostFallbackError: "lsappinfo info returned no parseable app name.",
      hasFrontmostCaptureError: true,
      hasFrontmostFallbackError: true,
    });
    expect(payload.tracker.frontmostCaptureDiagnostics.today).toMatchObject({
      unavailableSegments: 1,
      unavailableSeconds: 120,
      unavailableRatio: 0.5,
      systemEventsSegments: 0,
      lsappinfoSegments: 1,
      missingCaptureSourceSegments: 0,
      captureErrorSegments: 2,
      fallbackErrorSegments: 1,
      captureSourceCounts: {
        unavailable: 1,
        lsappinfo: 1,
      },
      captureErrorCounts: {
        "osascript timed out": 1,
        "System Events lookup failed": 1,
      },
      fallbackErrorCounts: {
        "lsappinfo info returned no parseable app name.": 1,
      },
    });
  });

  it("recognizes Aside app-only segments as supported browser diagnostics", () => {
    const asideSegment = segment({
      id: "aside-segment",
      appName: "Aside",
      browserName: null,
      siteDomain: "docs.example.test",
      siteUrl: "https://docs.example.test/aside",
      siteSource: "applescript",
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
        forceChromiumAxCapture: false,
        forceFrontmostFallbackCapture: false,
        forceBrowserHistoryUrlFallback: false,
        forceChromiumAxExtremeNudge: false,
      },
      status: null,
      accessibilityGranted: true,
      currentSnapshot: null,
      driftAlarm,
      driftAlarmDebugEvents: [],
      segments: [asideSegment],
      historySegments: [],
      leaderboardSegments: [],
      ai: baseAiDebug,
      error: null,
    });

    expect(payload.tracker.browserCaptureDiagnostics.today).toMatchObject({
      browserSegments: 1,
      siteContextSegments: 1,
      missingSiteContextSegments: 0,
      browserAutomationStatusCounts: {
        granted: 1,
      },
    });
    expect(payload.tracker.browserCaptureDiagnostics.today.byBrowser).toHaveLength(1);
    expect(payload.tracker.browserCaptureDiagnostics.today.byBrowser[0]).toMatchObject({
      browserName: "Aside",
      totalSegments: 1,
      siteContextSegments: 1,
      siteSourceCounts: {
        applescript: 1,
      },
    });
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
        forceFrontmostFallbackCapture: false,
        forceBrowserHistoryUrlFallback: false,
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
          memoryLabel: null,
          issueKind: "provider",
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
        forceFrontmostFallbackCapture: false,
        forceBrowserHistoryUrlFallback: false,
        forceChromiumAxExtremeNudge: false,
      },
      status: null,
      accessibilityGranted: true,
      currentSnapshot: null,
      driftAlarm,
      driftAlarmDebugEvents: [driftAlarmDebugEvent],
      contextualGuardAuditEvents: [contextualGuardAuditEvent],
      segments: [],
      historySegments: [],
      leaderboardSegments: [],
      ai: baseAiDebug,
      error: null,
    });

    expect(payload.driftAlarm.recentDebugEvents).toEqual([driftAlarmDebugEvent]);
    expect(payload.contextualGuard.recentEvents).toEqual([contextualGuardAuditEvent]);
  });

  it("exports enhanced context diagnostics without raw context values", () => {
    const rawDocumentBody = "Raw Notion body says acquisition roadmap password sk-live-secret";
    const rawShortHint = "Short hint copied from a confidential document";
    const rawBlockedValue = "Blocked Slack message body with one-time code 123456";
    const eventWithUnexpectedRawFields = Object.assign(
      {
        kind: "egress_decision",
        status: "blocked",
        reason: "sensitive_surface",
        sourceFamily: "communication_metadata",
        egress: {
          decisionCounts: { send: 0, metadata_only: 0, local_only: 0, blocked: 1 },
          dropReasonCounts: { sensitive_surface: 1 },
          providerSafeItemCount: 0,
          redactionCount: 0,
          maxDepthSent: null,
        },
      } satisfies EnhancedContextDebugEvent,
      {
        values: [rawDocumentBody],
        blockedValues: [rawBlockedValue],
        body: rawShortHint,
      },
    );
    const events: readonly EnhancedContextDebugEvent[] = [
      {
        kind: "capture_attempt",
        status: "attempted",
        reason: "structured_capture",
        sourceFamily: "document_knowledge",
      },
      eventWithUnexpectedRawFields,
      {
        kind: "retry_decision",
        status: "retry_skipped",
        reason: "retry_disabled",
        sourceFamily: "document_knowledge",
        retry: {
          threshold: 0.55,
          firstPassConfidence: 0.86,
          firstPassCategory: "workspace",
          providerSafeItemCount: 0,
        },
      },
    ];

    const payload = buildDebugLogPayload({
      selectedDay: "2026-06-13",
      startOfDayMinutes: 240,
      startOfWeek: "monday",
      theme: "light",
      categoryColorOverrides: {},
      appThemeColorOverrides: {},
      developerDiagnostics: {
        devModeEnabled: true,
        forceChromiumAxCapture: false,
        forceFrontmostFallbackCapture: false,
        forceBrowserHistoryUrlFallback: false,
        forceChromiumAxExtremeNudge: false,
      },
      enhancedContext: {
        settings: {
          enabled: true,
          captureLocal: true,
          retryLowConfidence: false,
          debugLogging: true,
          sourceFamilies: {
            document_knowledge: true,
            local_notes_markdown: false,
            work_tracker_dev_platform: false,
            design_dev_tool: false,
            calendar_meeting: false,
            communication_metadata: true,
            ai_conversation: false,
            developer_workspace: false,
            document_editor: false,
          },
        },
        events,
      },
      status: null,
      accessibilityGranted: true,
      currentSnapshot: null,
      driftAlarm,
      driftAlarmDebugEvents: [],
      segments: [],
      historySegments: [],
      leaderboardSegments: [],
      ai: baseAiDebug,
      error: null,
    });

    expect(payload.enhancedContext).toMatchObject({
      settings: {
        enabled: true,
        captureLocal: true,
        retryLowConfidence: false,
        debugLogging: true,
        sourceFamilies: {
          enabledCount: 2,
          enabledFamilies: ["document_knowledge", "communication_metadata"],
        },
      },
      diagnostics: {
        capture: {
          count: 1,
          statuses: { attempted: 1 },
          reasons: { structured_capture: 1 },
        },
        egress: {
          count: 1,
          statuses: { blocked: 1 },
          reasons: { sensitive_surface: 1 },
        },
        retry: {
          count: 1,
          statuses: { retry_skipped: 1 },
          reasons: { retry_disabled: 1 },
        },
        blockedSensitiveSurfaces: {
          count: 1,
          statuses: { blocked: 1 },
          reasons: { sensitive_surface: 1 },
        },
      },
    });
    expect(payload.enhancedContext.recentEvents).toHaveLength(3);
    expect(payload.enhancedContext.recentEvents[1]).not.toHaveProperty("values");
    expect(payload.enhancedContext.recentEvents[1]).not.toHaveProperty("blockedValues");
    expect(payload.enhancedContext.recentEvents[1]).not.toHaveProperty("body");

    const exportedJson = JSON.stringify(payload);
    expect(exportedJson).not.toContain(rawDocumentBody);
    expect(exportedJson).not.toContain(rawShortHint);
    expect(exportedJson).not.toContain(rawBlockedValue);
    expect(exportedJson).not.toContain("password");
    expect(exportedJson).not.toContain("sk-live-secret");
    expect(exportedJson).not.toContain("123456");
  });
});
