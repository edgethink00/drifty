import type { ActivitySegment, CurrentActivitySnapshot, DriftAlarmTrayStatus, TrackerStatus } from "@drifty/domain";
import type { ActivityCategory, AdaptiveProviderPolicyDecision } from "@drifty/domain";
import type { AiConnectionStatus, LocalAiProviderStatus } from "../ai-connection/AiConnectionStatusBar";
import type { BillingEntitlement } from "../billing/billingService";
import type { AiClassificationSummary, AiClassificationUsageSummary } from "../classification/aiClassificationService";
import type { ContentContextDropReason } from "../classification/contentContextEgressPolicy";
import type { ContextualGuardAuditEvent } from "../classification/contextualGuardAuditLog";
import type { DriftAlarmDebugEvent } from "../companion/driftAlarmDebugLog";
import type { InterventionLedgerEntry, InterventionLedgerSummary } from "../companion/interventionLedger";
import { getDeviceSyncNextAutomaticAttemptAt, type DeviceSyncCycleRecord } from "../device-sync/deviceSyncState";
import type { DeviceSyncStatus } from "../device-sync/deviceSyncTypes";
import { DEFAULT_ENHANCED_CONTEXT_SETTINGS, ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS } from "./settingsStorage";
import type {
  AppThemeColorOverrides,
  CategoryColorOverrides,
  EnhancedContextSettings,
  EnhancedContextSourceFamily,
  StartOfWeek,
  ThemeMode,
} from "./settingsStorage";

type BrowserCaptureDiagnosticsSource = "today" | "history" | "leaderboard";

export type BrowserCaptureSummary = {
  readonly browserName: string;
  readonly totalSegments: number;
  readonly siteContextSegments: number;
  readonly missingSiteContextSegments: number;
  readonly siteContextRatio: number | null;
  readonly accessibilityAddressBarFallbackSegments: number;
  readonly accessibilityAddressBarFallbackRatio: number | null;
  readonly siteSourceCounts: Readonly<Record<string, number>>;
  readonly browserAutomationStatusCounts: Readonly<Record<string, number>>;
  readonly browserAutomationErrorCounts: Readonly<Record<string, number>>;
  readonly browserAutomationErrorSegments: number;
  readonly browserAutomationDeniedSegments: number;
  readonly browserHistoryStatusCounts: Readonly<Record<string, number>>;
  readonly browserHistoryReasonCounts: Readonly<Record<string, number>>;
  readonly browserHistoryAttemptSegments: number;
  readonly browserHistoryDatabaseFoundSegments: number;
  readonly browserHistoryFallbackSegments: number;
  readonly browserHistoryFallbackRatio: number | null;
  readonly browserHistoryErrorSegments: number;
};

export type BrowserCaptureDiagnostics = {
  readonly source: BrowserCaptureDiagnosticsSource;
  readonly totalSegments: number;
  readonly browserSegments: number;
  readonly siteContextSegments: number;
  readonly missingSiteContextSegments: number;
  readonly siteContextRatio: number | null;
  readonly browserAutomationStatusCounts: Readonly<Record<string, number>>;
  readonly browserAutomationErrorCounts: Readonly<Record<string, number>>;
  readonly browserAutomationErrorSegments: number;
  readonly browserAutomationDeniedSegments: number;
  readonly browserHistoryStatusCounts: Readonly<Record<string, number>>;
  readonly browserHistoryReasonCounts: Readonly<Record<string, number>>;
  readonly browserHistoryAttemptSegments: number;
  readonly browserHistoryDatabaseFoundSegments: number;
  readonly browserHistoryFallbackSegments: number;
  readonly browserHistoryErrorSegments: number;
  readonly byBrowser: readonly BrowserCaptureSummary[];
};

export type FrontmostCaptureDiagnostics = {
  readonly source: BrowserCaptureDiagnosticsSource;
  readonly totalSegments: number;
  readonly unavailableSegments: number;
  readonly unavailableSeconds: number;
  readonly unavailableRatio: number | null;
  readonly systemEventsSegments: number;
  readonly lsappinfoSegments: number;
  readonly missingCaptureSourceSegments: number;
  readonly captureErrorSegments: number;
  readonly fallbackErrorSegments: number;
  readonly captureSourceCounts: Readonly<Record<string, number>>;
  readonly captureErrorCounts: Readonly<Record<string, number>>;
  readonly fallbackErrorCounts: Readonly<Record<string, number>>;
};

export type EnhancedContextDebugEventKind =
  | "capture_attempt"
  | "local_storage"
  | "egress_decision"
  | "retry_decision"
  | "blocked_sensitive_surface";

export type EnhancedContextDebugStatus =
  | "attempted"
  | "stored"
  | "dropped"
  | "disabled"
  | "allowed"
  | "metadata_only"
  | "local_only"
  | "blocked"
  | "retry_sent"
  | "retry_skipped"
  | "selected"
  | "error";

export type EnhancedContextDebugReason =
  | "structured_capture"
  | "source_family_disabled"
  | "storage_disabled"
  | "stored_local"
  | "dropped_by_policy"
  | "egress_filtered"
  | "sensitive_surface"
  | "local_only_policy"
  | "retry_disabled"
  | "no_provider_safe_context"
  | "unknown_category"
  | "low_confidence"
  | "insufficient_evidence"
  | "high_confidence"
  | "already_retried"
  | "provider_error";

type EnhancedContextDebugEventBase = {
  readonly kind: EnhancedContextDebugEventKind;
  readonly status: EnhancedContextDebugStatus;
  readonly reason: EnhancedContextDebugReason;
  readonly sourceFamily?: EnhancedContextSourceFamily;
};

export type EnhancedContextEgressDebugDetails = {
  readonly decisionCounts: Readonly<Record<AdaptiveProviderPolicyDecision, number>>;
  readonly dropReasonCounts: Readonly<Partial<Record<ContentContextDropReason, number>>>;
  readonly providerSafeItemCount: number;
  readonly redactionCount: number;
  readonly maxDepthSent: 1 | 2 | 3 | null;
};

export type EnhancedContextRetryDebugDetails = {
  readonly threshold: number;
  readonly firstPassConfidence: number;
  readonly firstPassCategory: ActivityCategory;
  readonly providerSafeItemCount: number;
  readonly selectedResult?: "first_pass" | "enhanced_retry";
};

export type EnhancedContextDebugEvent =
  | (EnhancedContextDebugEventBase & {
      readonly kind: "egress_decision";
      readonly egress: EnhancedContextEgressDebugDetails;
    })
  | (EnhancedContextDebugEventBase & {
      readonly kind: "retry_decision";
      readonly retry: EnhancedContextRetryDebugDetails;
    })
  | (EnhancedContextDebugEventBase & {
      readonly kind: "capture_attempt" | "local_storage" | "blocked_sensitive_surface";
    });

type EnhancedContextSettingsSummary = {
  readonly enabled: boolean;
  readonly captureLocal: boolean;
  readonly retryLowConfidence: boolean;
  readonly debugLogging: boolean;
  readonly sourceFamilies: {
    readonly enabledCount: number;
    readonly enabledFamilies: readonly EnhancedContextSourceFamily[];
  };
};

type EnhancedContextDiagnosticCounts = {
  readonly count: number;
  readonly statuses: Readonly<Partial<Record<EnhancedContextDebugStatus, number>>>;
  readonly reasons: Readonly<Partial<Record<EnhancedContextDebugReason, number>>>;
  readonly sourceFamilies: Readonly<Partial<Record<EnhancedContextSourceFamily, number>>>;
};

type EnhancedContextDiagnosticAccumulator = {
  count: number;
  statuses: Partial<Record<EnhancedContextDebugStatus, number>>;
  reasons: Partial<Record<EnhancedContextDebugReason, number>>;
  sourceFamilies: Partial<Record<EnhancedContextSourceFamily, number>>;
};

export type EnhancedContextDebugSummary = {
  readonly settings: EnhancedContextSettingsSummary;
  readonly recentEvents: readonly EnhancedContextDebugEvent[];
  readonly diagnostics: {
    readonly capture: EnhancedContextDiagnosticCounts;
    readonly storage: EnhancedContextDiagnosticCounts;
    readonly egress: EnhancedContextDiagnosticCounts;
    readonly retry: EnhancedContextDiagnosticCounts;
    readonly blockedSensitiveSurfaces: EnhancedContextDiagnosticCounts;
  };
};

export type EnhancedContextDebugInput = {
  readonly settings?: EnhancedContextSettings;
  readonly events?: readonly EnhancedContextDebugEvent[];
};

type BrowserCaptureAccumulator = {
  browserName: string;
  totalSegments: number;
  siteContextSegments: number;
  missingSiteContextSegments: number;
  accessibilityAddressBarFallbackSegments: number;
  siteSourceCounts: Record<string, number>;
  browserAutomationStatusCounts: Record<string, number>;
  browserAutomationErrorCounts: Record<string, number>;
  browserAutomationErrorSegments: number;
  browserAutomationDeniedSegments: number;
  browserHistoryStatusCounts: Record<string, number>;
  browserHistoryReasonCounts: Record<string, number>;
  browserHistoryAttemptSegments: number;
  browserHistoryDatabaseFoundSegments: number;
  browserHistoryFallbackSegments: number;
  browserHistoryErrorSegments: number;
};

type BuildDebugLogPayloadInput = {
  readonly selectedDay: string;
  readonly startOfDayMinutes: number;
  readonly startOfWeek: StartOfWeek;
  readonly theme: ThemeMode;
  readonly categoryColorOverrides: CategoryColorOverrides;
  readonly appThemeColorOverrides: AppThemeColorOverrides;
  readonly developerDiagnostics: {
    readonly devModeEnabled: boolean;
    readonly forceChromiumAxCapture: boolean;
    readonly forceFrontmostFallbackCapture: boolean;
    readonly forceBrowserHistoryUrlFallback: boolean;
    readonly forceChromiumAxExtremeNudge: boolean;
  };
  readonly enhancedContext?: EnhancedContextDebugInput;
  readonly status: TrackerStatus | null;
  readonly accessibilityGranted: boolean;
  readonly currentSnapshot: CurrentActivitySnapshot | null;
  readonly driftAlarm: DriftAlarmTrayStatus;
  readonly driftAlarmDebugEvents: readonly DriftAlarmDebugEvent[];
  readonly interventionLedger?: {
    readonly retentionDays: number;
    readonly last7Days: InterventionLedgerSummary;
    readonly last30Days: InterventionLedgerSummary;
    readonly entries: readonly InterventionLedgerEntry[];
  } | null;
  readonly contextualGuardAuditEvents?: readonly ContextualGuardAuditEvent[];
  readonly segments: readonly ActivitySegment[];
  readonly historySegments: readonly ActivitySegment[];
  readonly leaderboardSegments: readonly ActivitySegment[];
  readonly ai: AiDebugLogInput;
  readonly deviceSync?: DeviceSyncDebugInput;
  readonly error: string | null;
};

export type DeviceSyncDebugInput = {
  readonly featureVisible: boolean;
  readonly optedIn: boolean;
  readonly gateActive: boolean;
  readonly accountResetPending: boolean;
  readonly gates: {
    readonly accountScopeReady: boolean;
    readonly cloudOnline: boolean;
    readonly supabaseConfigured: boolean;
    readonly signedIn: boolean;
    readonly billingEligible: boolean;
  };
  readonly status: DeviceSyncStatus;
  readonly cycleRecord: DeviceSyncCycleRecord | null;
};

export type AiDebugLogInput = {
  readonly route: "cloud" | "local" | "disabled";
  readonly connectionStatus: AiConnectionStatus;
  readonly cloud: {
    readonly isSupabaseConfigured: boolean;
    readonly hasRequiredAccountAuth: boolean;
    readonly canUseCloudAiClassification: boolean;
    readonly entitlement: BillingEntitlement | null;
    readonly entitlementLoading: boolean;
    readonly entitlementError: string | null;
  };
  readonly local: {
    readonly providerLabel: string;
    readonly providerStatus: LocalAiProviderStatus;
  };
  readonly classification: {
    readonly actionLoading: boolean;
    readonly summary: AiClassificationSummary | null;
    readonly observedFailure: boolean;
  };
  readonly usage: {
    readonly day: string | null;
    readonly summary: AiClassificationUsageSummary | null;
  };
};

const SUPPORTED_BROWSER_NAMES = [
  "Arc",
  "Aside",
  "Brave Browser",
  "Chromium",
  "Floorp",
  "Firefox",
  "Firefox Developer Edition",
  "Google Chrome",
  "Google Chrome Canary",
  "Microsoft Edge",
  "Opera",
  "Safari",
  "Safari Technology Preview",
  "Vivaldi",
  "Whale",
  "Zen",
];

const SUPPORTED_BROWSER_NAME_SET: ReadonlySet<string> = new Set(SUPPORTED_BROWSER_NAMES);
const MISSING_DIAGNOSTIC_VALUE = "missing";
const MAX_BROWSER_AUTOMATION_ERROR_LENGTH = 240;
const MAX_ENHANCED_CONTEXT_DEBUG_EVENTS = 100;
const enhancedContextDebugEvents: EnhancedContextDebugEvent[] = [];

export function recordEnhancedContextDebugEvent(event: EnhancedContextDebugEvent): void {
  enhancedContextDebugEvents.push(sanitizeEnhancedContextDebugEvent(event));
  if (enhancedContextDebugEvents.length > MAX_ENHANCED_CONTEXT_DEBUG_EVENTS) {
    enhancedContextDebugEvents.splice(0, enhancedContextDebugEvents.length - MAX_ENHANCED_CONTEXT_DEBUG_EVENTS);
  }
}

export function readRecentEnhancedContextDebugEvents(): readonly EnhancedContextDebugEvent[] {
  return enhancedContextDebugEvents.map(sanitizeEnhancedContextDebugEvent);
}

export function clearEnhancedContextDebugEventsForTests(): void {
  enhancedContextDebugEvents.length = 0;
}

export function buildDebugLogPayload(input: BuildDebugLogPayloadInput) {
  const currentSnapshot = buildCurrentSnapshotSummary(input.currentSnapshot);
  const enhancedContext = buildEnhancedContextDebugSummary(input.enhancedContext);

  return {
    exportedAt: new Date().toISOString(),
    selectedDay: input.selectedDay,
    settings: {
      startOfDayMinutes: input.startOfDayMinutes,
      startOfWeek: input.startOfWeek,
      theme: input.theme,
      categoryColorOverrides: input.categoryColorOverrides,
      appThemeColorOverrides: input.appThemeColorOverrides,
      developerDiagnostics: input.developerDiagnostics,
    },
    tracker: {
      running: input.status?.running ?? null,
      lastEventAt: input.status?.lastEventAt ?? null,
      databasePath: input.status?.databasePath ?? null,
      accessibilityGranted: input.accessibilityGranted,
      currentSnapshot,
      browserAutomation: currentSnapshot
        ? {
            browserName: currentSnapshot.browserName,
            status: currentSnapshot.browserAutomationStatus,
            hasError: currentSnapshot.hasBrowserAutomationError,
            error: currentSnapshot.browserAutomationError,
            siteSource: currentSnapshot.siteSource,
            captureConfidence: currentSnapshot.captureConfidence,
            hasSiteContext: currentSnapshot.hasSiteContext,
          }
        : null,
      browserHistoryFallback: buildBrowserHistoryFallbackSummary(currentSnapshot),
      frontmostCapture: currentSnapshot
        ? {
            source: currentSnapshot.frontmostCaptureSource,
            hasCaptureError: currentSnapshot.hasFrontmostCaptureError,
            captureError: currentSnapshot.frontmostCaptureError,
            hasFallbackError: currentSnapshot.hasFrontmostFallbackError,
            fallbackError: currentSnapshot.frontmostFallbackError,
          }
        : null,
      browserCaptureDiagnostics: {
        today: buildBrowserCaptureDiagnostics("today", input.segments),
        history: buildBrowserCaptureDiagnostics("history", input.historySegments),
        leaderboard: buildBrowserCaptureDiagnostics("leaderboard", input.leaderboardSegments),
      },
      frontmostCaptureDiagnostics: {
        today: buildFrontmostCaptureDiagnostics("today", input.segments),
        history: buildFrontmostCaptureDiagnostics("history", input.historySegments),
        leaderboard: buildFrontmostCaptureDiagnostics("leaderboard", input.leaderboardSegments),
      },
    },
    driftAlarm: {
      ...input.driftAlarm,
      recentDebugEvents: input.driftAlarmDebugEvents,
      interventionLedger: input.interventionLedger ?? null,
    },
    contextualGuard: {
      retentionDays: 14,
      recentEvents: input.contextualGuardAuditEvents ?? [],
    },
    enhancedContext,
    deviceSync: buildDeviceSyncDebugSummary(input.deviceSync),
    ai: buildAiDebugSummary(input.ai),
    counts: {
      todaySegments: input.segments.length,
      historySegments: input.historySegments.length,
      leaderboardSegments: input.leaderboardSegments.length,
    },
    error: input.error,
  };
}

export function buildDeviceSyncDebugSummary(input: DeviceSyncDebugInput | null | undefined) {
  if (!input) return null;
  const { status, cycleRecord } = input;
  const totalSeq = status.backfill?.totalSeq ?? 0;
  const pushedSeq = status.backfill?.pushedSeq ?? 0;
  return {
    featureVisible: input.featureVisible,
    optedIn: input.optedIn,
    gateActive: input.gateActive,
    accountResetPending: input.accountResetPending,
    gates: input.gates,
    runtime: {
      enabled: status.enabled,
      hasDeviceIdentity: Boolean(status.deviceId),
      lastPushedAt: status.lastPushedAt,
      lastPulledAt: status.lastPulledAt,
      pendingPushCount: status.pendingPushCount,
      backfill: status.backfill
        ? {
            totalSeq,
            pushedSeq,
            completionRatio: totalSeq <= 0 ? 1 : ratio(Math.min(pushedSeq, totalSeq), totalSeq),
          }
        : null,
      error: {
        present: status.lastError !== null,
        code: sanitizeDeviceSyncDiagnosticToken(status.lastErrorCode),
        httpStatus: status.lastErrorHttpStatus,
        lockedReason: sanitizeDeviceSyncDiagnosticToken(status.lastErrorLockedReason),
      },
    },
    pacing: cycleRecord
      ? {
          lastAttemptAt: cycleRecord.lastAttemptAt,
          lastSuccessAt: cycleRecord.lastSuccessAt,
          lastErrorAt: cycleRecord.lastErrorAt,
          consecutiveFailureCount: cycleRecord.consecutiveFailureCount ?? (cycleRecord.lastErrorAt ? 1 : 0),
          nextAutomaticAttemptAt: getDeviceSyncNextAutomaticAttemptAt(cycleRecord),
        }
      : null,
  };
}

function sanitizeDeviceSyncDiagnosticToken(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : "unknown";
}

export function buildEnhancedContextDebugSummary(input: EnhancedContextDebugInput | null | undefined): EnhancedContextDebugSummary {
  const settings = buildEnhancedContextSettingsSummary(input?.settings ?? DEFAULT_ENHANCED_CONTEXT_SETTINGS);
  const recentEvents = (input?.events ?? []).map(sanitizeEnhancedContextDebugEvent);
  const diagnostics = buildEnhancedContextDiagnostics(recentEvents);
  return { settings, recentEvents, diagnostics };
}

function sanitizeEnhancedContextDebugEvent(event: EnhancedContextDebugEvent): EnhancedContextDebugEvent {
  switch (event.kind) {
    case "egress_decision":
      return {
        kind: event.kind,
        status: event.status,
        reason: event.reason,
        ...(event.sourceFamily ? { sourceFamily: event.sourceFamily } : {}),
        egress: {
          decisionCounts: event.egress.decisionCounts,
          dropReasonCounts: event.egress.dropReasonCounts,
          providerSafeItemCount: event.egress.providerSafeItemCount,
          redactionCount: event.egress.redactionCount,
          maxDepthSent: event.egress.maxDepthSent,
        },
      };
    case "retry_decision":
      return {
        kind: event.kind,
        status: event.status,
        reason: event.reason,
        ...(event.sourceFamily ? { sourceFamily: event.sourceFamily } : {}),
        retry: {
          threshold: event.retry.threshold,
          firstPassConfidence: event.retry.firstPassConfidence,
          firstPassCategory: event.retry.firstPassCategory,
          providerSafeItemCount: event.retry.providerSafeItemCount,
          ...(event.retry.selectedResult ? { selectedResult: event.retry.selectedResult } : {}),
        },
      };
    case "capture_attempt":
    case "local_storage":
    case "blocked_sensitive_surface":
      return {
        kind: event.kind,
        status: event.status,
        reason: event.reason,
        ...(event.sourceFamily ? { sourceFamily: event.sourceFamily } : {}),
      };
    default:
      return assertNeverEnhancedContextDebugEvent(event);
  }
}

class EnhancedContextDebugEventError extends Error {
  constructor(readonly event: never) {
    super(`Unhandled enhanced context debug event: ${event}`);
    this.name = "EnhancedContextDebugEventError";
  }
}

function assertNeverEnhancedContextDebugEvent(event: never): never {
  throw new EnhancedContextDebugEventError(event);
}

function buildEnhancedContextSettingsSummary(settings: EnhancedContextSettings): EnhancedContextSettingsSummary {
  const enabledFamilies = ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS
    .filter((option) => settings.sourceFamilies[option.family])
    .map((option) => option.family);

  return {
    enabled: settings.enabled,
    captureLocal: settings.captureLocal,
    retryLowConfidence: settings.retryLowConfidence,
    debugLogging: settings.debugLogging,
    sourceFamilies: {
      enabledCount: enabledFamilies.length,
      enabledFamilies,
    },
  };
}

function buildEnhancedContextDiagnostics(events: readonly EnhancedContextDebugEvent[]): EnhancedContextDebugSummary["diagnostics"] {
  const capture = emptyEnhancedContextDiagnosticCounts();
  const storage = emptyEnhancedContextDiagnosticCounts();
  const egress = emptyEnhancedContextDiagnosticCounts();
  const retry = emptyEnhancedContextDiagnosticCounts();
  const blockedSensitiveSurfaces = emptyEnhancedContextDiagnosticCounts();

  for (const event of events) {
    switch (event.kind) {
      case "capture_attempt":
        recordEnhancedContextEvent(capture, event);
        break;
      case "local_storage":
        recordEnhancedContextEvent(storage, event);
        break;
      case "egress_decision":
        recordEnhancedContextEvent(egress, event);
        break;
      case "retry_decision":
        recordEnhancedContextEvent(retry, event);
        break;
      case "blocked_sensitive_surface":
        recordEnhancedContextEvent(blockedSensitiveSurfaces, event);
        break;
      default:
        assertNeverEnhancedContextDebugEvent(event);
    }

    if (event.kind !== "blocked_sensitive_surface" && event.reason === "sensitive_surface") {
      recordEnhancedContextEvent(blockedSensitiveSurfaces, event);
    }
  }

  return { capture, storage, egress, retry, blockedSensitiveSurfaces };
}

function emptyEnhancedContextDiagnosticCounts(): EnhancedContextDiagnosticAccumulator {
  const statuses: Partial<Record<EnhancedContextDebugStatus, number>> = {};
  const reasons: Partial<Record<EnhancedContextDebugReason, number>> = {};
  const sourceFamilies: Partial<Record<EnhancedContextSourceFamily, number>> = {};
  return { count: 0, statuses, reasons, sourceFamilies };
}

function recordEnhancedContextEvent(
  summary: EnhancedContextDiagnosticAccumulator,
  event: EnhancedContextDebugEvent,
): void {
  summary.count += 1;
  incrementTypedCount(summary.statuses, event.status);
  incrementTypedCount(summary.reasons, event.reason);
  if (event.sourceFamily) {
    incrementTypedCount(summary.sourceFamilies, event.sourceFamily);
  }
}

function buildAiDebugSummary(input: AiDebugLogInput) {
  return {
    route: input.route,
    connection: input.connectionStatus,
    cloud: {
      isSupabaseConfigured: input.cloud.isSupabaseConfigured,
      hasRequiredAccountAuth: input.cloud.hasRequiredAccountAuth,
      canUseCloudAiClassification: input.cloud.canUseCloudAiClassification,
      entitlementLoading: input.cloud.entitlementLoading,
      entitlementError: input.cloud.entitlementError,
      entitlement: input.cloud.entitlement
        ? {
            plan: input.cloud.entitlement.plan,
            status: input.cloud.entitlement.status,
            canUseApp: input.cloud.entitlement.canUseApp,
            lockedReason: input.cloud.entitlement.lockedReason ?? null,
            trialEndsAt: input.cloud.entitlement.trialEndsAt,
            currentPeriodEnd: input.cloud.entitlement.currentPeriodEnd,
          }
        : null,
    },
    local: {
      providerLabel: input.local.providerLabel,
      providerStatus: input.local.providerStatus,
    },
    classification: {
      actionLoading: input.classification.actionLoading,
      observedFailure: input.classification.observedFailure,
      summary: input.classification.summary
        ? {
            status: input.classification.summary.status,
            selectedSegments: input.classification.summary.selectedSegments,
            savedRecords: input.classification.summary.savedRecords,
            message: input.classification.summary.message,
            metrics: input.classification.summary.metrics ?? null,
          }
        : null,
    },
    usage: {
      day: input.usage.day,
      summary: input.usage.summary,
    },
  };
}

function buildCurrentSnapshotSummary(snapshot: CurrentActivitySnapshot | null) {
  if (!snapshot) return null;

  return {
    appName: snapshot.appName,
    bundleId: snapshot.bundleId ?? null,
    source: snapshot.source,
    systemTransientActivity: snapshot.systemTransientActivity ?? null,
    browserName: snapshot.browserName ?? null,
    siteSource: snapshot.siteSource ?? null,
    captureConfidence: snapshot.captureConfidence ?? null,
    hasSiteContext: hasSiteContext(snapshot),
    browserAutomationStatus: snapshot.browserAutomationStatus ?? null,
    browserAutomationError: browserAutomationError(snapshot.browserAutomationError),
    hasBrowserAutomationError: Boolean(cleanText(snapshot.browserAutomationError)),
    browserHistoryStatus: snapshot.browserHistoryStatus ?? null,
    browserHistoryReason: cleanText(snapshot.browserHistoryReason) ?? null,
    browserHistoryDatabaseFound: snapshot.browserHistoryDatabaseFound ?? null,
    browserHistoryProfileCount: snapshot.browserHistoryProfileCount ?? null,
    browserHistoryCandidateCount: snapshot.browserHistoryCandidateCount ?? null,
    browserHistoryErrorCount: snapshot.browserHistoryErrorCount ?? null,
    frontmostCaptureSource: snapshot.frontmostCaptureSource ?? null,
    frontmostCaptureError: diagnosticError(snapshot.frontmostCaptureError),
    frontmostFallbackError: diagnosticError(snapshot.frontmostFallbackError),
    hasFrontmostCaptureError: Boolean(cleanText(snapshot.frontmostCaptureError)),
    hasFrontmostFallbackError: Boolean(cleanText(snapshot.frontmostFallbackError)),
  };
}

function buildBrowserHistoryFallbackSummary(currentSnapshot: ReturnType<typeof buildCurrentSnapshotSummary>) {
  if (!currentSnapshot?.browserHistoryStatus) return null;

  return {
    status: currentSnapshot.browserHistoryStatus,
    reason: currentSnapshot.browserHistoryReason,
    databaseFound: currentSnapshot.browserHistoryDatabaseFound,
    profileCount: currentSnapshot.browserHistoryProfileCount,
    candidateCount: currentSnapshot.browserHistoryCandidateCount,
    errorCount: currentSnapshot.browserHistoryErrorCount,
  };
}

function buildFrontmostCaptureDiagnostics(
  source: BrowserCaptureDiagnosticsSource,
  segments: readonly ActivitySegment[],
): FrontmostCaptureDiagnostics {
  const captureSourceCounts: Record<string, number> = {};
  const captureErrorCounts: Record<string, number> = {};
  const fallbackErrorCounts: Record<string, number> = {};
  let unavailableSegments = 0;
  let unavailableSeconds = 0;
  let systemEventsSegments = 0;
  let lsappinfoSegments = 0;
  let missingCaptureSourceSegments = 0;
  let captureErrorSegments = 0;
  let fallbackErrorSegments = 0;

  for (const segment of segments) {
    const captureSource = cleanText(segment.frontmostCaptureSource) ?? MISSING_DIAGNOSTIC_VALUE;
    incrementCount(captureSourceCounts, captureSource);
    if (captureSource === "system-events") systemEventsSegments += 1;
    if (captureSource === "lsappinfo") lsappinfoSegments += 1;
    if (captureSource === MISSING_DIAGNOSTIC_VALUE) missingCaptureSourceSegments += 1;

    const captureError = diagnosticError(segment.frontmostCaptureError);
    if (captureError) {
      captureErrorSegments += 1;
      incrementCount(captureErrorCounts, captureError);
    }

    const fallbackError = diagnosticError(segment.frontmostFallbackError);
    if (fallbackError) {
      fallbackErrorSegments += 1;
      incrementCount(fallbackErrorCounts, fallbackError);
    }

    if (segment.appName === "Unavailable") {
      unavailableSegments += 1;
      unavailableSeconds += segment.durationSeconds;
    }
  }

  return {
    source,
    totalSegments: segments.length,
    unavailableSegments,
    unavailableSeconds,
    unavailableRatio: ratio(unavailableSegments, segments.length),
    systemEventsSegments,
    lsappinfoSegments,
    missingCaptureSourceSegments,
    captureErrorSegments,
    fallbackErrorSegments,
    captureSourceCounts,
    captureErrorCounts,
    fallbackErrorCounts,
  };
}

function buildBrowserCaptureDiagnostics(
  source: BrowserCaptureDiagnosticsSource,
  segments: readonly ActivitySegment[],
): BrowserCaptureDiagnostics {
  const byBrowser = new Map<string, BrowserCaptureAccumulator>();
  let browserSegments = 0;
  let siteContextSegments = 0;
  let missingSiteContextSegments = 0;
  let browserAutomationErrorSegments = 0;
  let browserAutomationDeniedSegments = 0;
  let browserHistoryAttemptSegments = 0;
  let browserHistoryDatabaseFoundSegments = 0;
  let browserHistoryFallbackSegments = 0;
  let browserHistoryErrorSegments = 0;
  const browserAutomationStatusCounts: Record<string, number> = {};
  const browserAutomationErrorCounts: Record<string, number> = {};
  const browserHistoryStatusCounts: Record<string, number> = {};
  const browserHistoryReasonCounts: Record<string, number> = {};

  for (const segment of segments) {
    const browserName = resolveBrowserName(segment);
    if (!browserName) continue;

    browserSegments += 1;
    const hasContext = hasSiteContext(segment);
    if (hasContext) siteContextSegments += 1;
    else missingSiteContextSegments += 1;

    const accumulator = byBrowser.get(browserName) ?? {
      browserName,
      totalSegments: 0,
      siteContextSegments: 0,
      missingSiteContextSegments: 0,
      accessibilityAddressBarFallbackSegments: 0,
      siteSourceCounts: {},
      browserAutomationStatusCounts: {},
      browserAutomationErrorCounts: {},
      browserAutomationErrorSegments: 0,
      browserAutomationDeniedSegments: 0,
      browserHistoryStatusCounts: {},
      browserHistoryReasonCounts: {},
      browserHistoryAttemptSegments: 0,
      browserHistoryDatabaseFoundSegments: 0,
      browserHistoryFallbackSegments: 0,
      browserHistoryErrorSegments: 0,
    };

    accumulator.totalSegments += 1;
    if (hasContext) accumulator.siteContextSegments += 1;
    else accumulator.missingSiteContextSegments += 1;

    const siteSource = segment.siteSource ?? "missing";
    incrementCount(accumulator.siteSourceCounts, siteSource);
    if (siteSource === "accessibility-address-bar") {
      accumulator.accessibilityAddressBarFallbackSegments += 1;
    }
    if (siteSource === "browser-history-title") {
      browserHistoryFallbackSegments += 1;
      accumulator.browserHistoryFallbackSegments += 1;
    }

    const automationStatus = segment.browserAutomationStatus ?? MISSING_DIAGNOSTIC_VALUE;
    incrementCount(browserAutomationStatusCounts, automationStatus);
    incrementCount(accumulator.browserAutomationStatusCounts, automationStatus);
    if (automationStatus === "denied") {
      browserAutomationDeniedSegments += 1;
      accumulator.browserAutomationDeniedSegments += 1;
    }

    const automationError = browserAutomationError(segment.browserAutomationError);
    if (automationError) {
      browserAutomationErrorSegments += 1;
      accumulator.browserAutomationErrorSegments += 1;
      incrementCount(browserAutomationErrorCounts, automationError);
      incrementCount(accumulator.browserAutomationErrorCounts, automationError);
    }

    const historyStatus = segment.browserHistoryStatus ?? MISSING_DIAGNOSTIC_VALUE;
    incrementCount(browserHistoryStatusCounts, historyStatus);
    incrementCount(accumulator.browserHistoryStatusCounts, historyStatus);
    if (segment.browserHistoryStatus) {
      browserHistoryAttemptSegments += 1;
      accumulator.browserHistoryAttemptSegments += 1;
    }

    const historyReason = cleanText(segment.browserHistoryReason);
    if (historyReason) {
      incrementCount(browserHistoryReasonCounts, historyReason);
      incrementCount(accumulator.browserHistoryReasonCounts, historyReason);
    }

    if (segment.browserHistoryDatabaseFound === true) {
      browserHistoryDatabaseFoundSegments += 1;
      accumulator.browserHistoryDatabaseFoundSegments += 1;
    }

    if ((segment.browserHistoryErrorCount ?? 0) > 0) {
      browserHistoryErrorSegments += 1;
      accumulator.browserHistoryErrorSegments += 1;
    }

    byBrowser.set(browserName, accumulator);
  }

  const summaries = Array.from(byBrowser.values())
    .map((summary) => ({
      browserName: summary.browserName,
      totalSegments: summary.totalSegments,
      siteContextSegments: summary.siteContextSegments,
      missingSiteContextSegments: summary.missingSiteContextSegments,
      siteContextRatio: ratio(summary.siteContextSegments, summary.totalSegments),
      accessibilityAddressBarFallbackSegments: summary.accessibilityAddressBarFallbackSegments,
      accessibilityAddressBarFallbackRatio: ratio(summary.accessibilityAddressBarFallbackSegments, summary.totalSegments),
      browserHistoryFallbackSegments: summary.browserHistoryFallbackSegments,
      browserHistoryFallbackRatio: ratio(summary.browserHistoryFallbackSegments, summary.totalSegments),
      siteSourceCounts: { ...summary.siteSourceCounts },
      browserAutomationStatusCounts: { ...summary.browserAutomationStatusCounts },
      browserAutomationErrorCounts: { ...summary.browserAutomationErrorCounts },
      browserAutomationErrorSegments: summary.browserAutomationErrorSegments,
      browserAutomationDeniedSegments: summary.browserAutomationDeniedSegments,
      browserHistoryStatusCounts: { ...summary.browserHistoryStatusCounts },
      browserHistoryReasonCounts: { ...summary.browserHistoryReasonCounts },
      browserHistoryAttemptSegments: summary.browserHistoryAttemptSegments,
      browserHistoryDatabaseFoundSegments: summary.browserHistoryDatabaseFoundSegments,
      browserHistoryErrorSegments: summary.browserHistoryErrorSegments,
    }))
    .sort((left, right) => right.totalSegments - left.totalSegments || left.browserName.localeCompare(right.browserName));

  return {
    source,
    totalSegments: segments.length,
    browserSegments,
    siteContextSegments,
    missingSiteContextSegments,
    siteContextRatio: ratio(siteContextSegments, browserSegments),
    browserAutomationStatusCounts,
    browserAutomationErrorCounts,
    browserAutomationErrorSegments,
    browserAutomationDeniedSegments,
    browserHistoryStatusCounts,
    browserHistoryReasonCounts,
    browserHistoryAttemptSegments,
    browserHistoryDatabaseFoundSegments,
    browserHistoryFallbackSegments,
    browserHistoryErrorSegments,
    byBrowser: summaries,
  };
}

function resolveBrowserName(segment: ActivitySegment): string | null {
  const browserName = cleanText(segment.browserName);
  if (browserName) return browserName;

  const appName = cleanText(segment.appName);
  return appName && SUPPORTED_BROWSER_NAME_SET.has(appName) ? appName : null;
}

function hasSiteContext(segment: Pick<ActivitySegment, "siteDomain" | "siteTitle" | "siteUrl">): boolean {
  return Boolean(cleanText(segment.siteDomain) || cleanText(segment.siteTitle) || cleanText(segment.siteUrl));
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function browserAutomationError(value: string | null | undefined): string | null {
  return diagnosticError(value);
}

function diagnosticError(value: string | null | undefined): string | null {
  const cleaned = cleanText(value)?.replace(/\s+/g, " ");
  if (!cleaned) return null;
  if (cleaned.length <= MAX_BROWSER_AUTOMATION_ERROR_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_BROWSER_AUTOMATION_ERROR_LENGTH - 3)}...`;
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function incrementTypedCount<Key extends string>(counts: Partial<Record<Key, number>>, key: Key): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function ratio(value: number, total: number): number | null {
  if (total === 0) return null;
  return Number((value / total).toFixed(4));
}
