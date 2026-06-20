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
};

export type BrowserCaptureDiagnostics = {
  readonly source: BrowserCaptureDiagnosticsSource;
  readonly totalSegments: number;
  readonly browserSegments: number;
  readonly siteContextSegments: number;
  readonly missingSiteContextSegments: number;
  readonly siteContextRatio: number | null;
  readonly byBrowser: readonly BrowserCaptureSummary[];
};

type BrowserCaptureAccumulator = {
  browserName: string;
  totalSegments: number;
  siteContextSegments: number;
  missingSiteContextSegments: number;
  accessibilityAddressBarFallbackSegments: number;
  siteSourceCounts: Record<string, number>;
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
            siteSource: currentSnapshot.siteSource,
            captureConfidence: currentSnapshot.captureConfidence,
            hasSiteContext: currentSnapshot.hasSiteContext,
          }
        : null,
      browserCaptureDiagnostics: {
        today: buildBrowserCaptureDiagnostics("today", input.segments),
        history: buildBrowserCaptureDiagnostics("history", input.historySegments),
        leaderboard: buildBrowserCaptureDiagnostics("leaderboard", input.leaderboardSegments),
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
    hasBrowserAutomationError: Boolean(cleanText(snapshot.browserAutomationError)),
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
    };

    accumulator.totalSegments += 1;
    if (hasContext) accumulator.siteContextSegments += 1;
    else accumulator.missingSiteContextSegments += 1;

    const siteSource = segment.siteSource ?? "missing";
    incrementCount(accumulator.siteSourceCounts, siteSource);
    if (siteSource === "accessibility-address-bar") {
      accumulator.accessibilityAddressBarFallbackSegments += 1;
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
    }))
    .sort((left, right) => right.totalSegments - left.totalSegments || left.browserName.localeCompare(right.browserName));

  return {
    source,
    totalSegments: segments.length,
    browserSegments,
    siteContextSegments,
    missingSiteContextSegments,
    siteContextRatio: ratio(siteContextSegments, browserSegments),
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

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function ratio(value: number, total: number): number | null {
  if (total === 0) return null;
  return Number((value / total).toFixed(4));
}
