import type { ActivitySegment, CurrentActivitySnapshot, DriftAlarmTrayStatus, TrackerStatus } from "@drifty/domain";
import type { AiConnectionStatus, LocalAiProviderStatus } from "../ai-connection/AiConnectionStatusBar";
import type { BillingEntitlement } from "../billing/billingService";
import type { AiClassificationSummary, AiClassificationUsageSummary } from "../classification/aiClassificationService";
import type { DriftAlarmDebugEvent } from "../companion/driftAlarmDebugLog";
import type { AppThemeColorOverrides, CategoryColorOverrides, StartOfWeek, ThemeMode } from "./settingsStorage";

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
    readonly forceChromiumAxExtremeNudge: boolean;
  };
  readonly status: TrackerStatus | null;
  readonly accessibilityGranted: boolean;
  readonly currentSnapshot: CurrentActivitySnapshot | null;
  readonly driftAlarm: DriftAlarmTrayStatus;
  readonly driftAlarmDebugEvents: readonly DriftAlarmDebugEvent[];
  readonly segments: readonly ActivitySegment[];
  readonly historySegments: readonly ActivitySegment[];
  readonly leaderboardSegments: readonly ActivitySegment[];
  readonly ai: AiDebugLogInput;
  readonly error: string | null;
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
    readonly providerLabel: "BYOK AI" | "Local AI";
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
  "Brave Browser",
  "Chromium",
  "Firefox",
  "Google Chrome",
  "Microsoft Edge",
  "Safari",
];

const SUPPORTED_BROWSER_NAME_SET: ReadonlySet<string> = new Set(SUPPORTED_BROWSER_NAMES);
const MISSING_DIAGNOSTIC_VALUE = "missing";
const MAX_BROWSER_AUTOMATION_ERROR_LENGTH = 240;

export function buildDebugLogPayload(input: BuildDebugLogPayloadInput) {
  const currentSnapshot = buildCurrentSnapshotSummary(input.currentSnapshot);

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
    },
    ai: buildAiDebugSummary(input.ai),
    counts: {
      todaySegments: input.segments.length,
      historySegments: input.historySegments.length,
      leaderboardSegments: input.leaderboardSegments.length,
    },
    error: input.error,
  };
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
    frontmostCaptureSource: snapshot.frontmostCaptureSource ?? null,
    frontmostCaptureError: diagnosticError(snapshot.frontmostCaptureError),
    frontmostFallbackError: diagnosticError(snapshot.frontmostFallbackError),
    hasFrontmostCaptureError: Boolean(cleanText(snapshot.frontmostCaptureError)),
    hasFrontmostFallbackError: Boolean(cleanText(snapshot.frontmostFallbackError)),
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
  const browserAutomationStatusCounts: Record<string, number> = {};
  const browserAutomationErrorCounts: Record<string, number> = {};

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
    };

    accumulator.totalSegments += 1;
    if (hasContext) accumulator.siteContextSegments += 1;
    else accumulator.missingSiteContextSegments += 1;

    const siteSource = segment.siteSource ?? "missing";
    incrementCount(accumulator.siteSourceCounts, siteSource);
    if (siteSource === "accessibility-address-bar") {
      accumulator.accessibilityAddressBarFallbackSegments += 1;
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
      siteSourceCounts: { ...summary.siteSourceCounts },
      browserAutomationStatusCounts: { ...summary.browserAutomationStatusCounts },
      browserAutomationErrorCounts: { ...summary.browserAutomationErrorCounts },
      browserAutomationErrorSegments: summary.browserAutomationErrorSegments,
      browserAutomationDeniedSegments: summary.browserAutomationDeniedSegments,
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

function ratio(value: number, total: number): number | null {
  if (total === 0) return null;
  return Number((value / total).toFixed(4));
}
