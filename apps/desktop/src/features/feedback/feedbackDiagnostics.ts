import type { ActivitySegment, TrackerStatus } from "@drifty/domain";
import { sanitizePostHogEventProperties } from "../../lib/analytics/privacyGuard";
import type { SupportJournalEntry } from "../../lib/diagnostics/supportJournal";
import type { NativeFeedbackDiagnostics } from "../../lib/api/feedbackDiagnosticsClient";
import type { DriftAlarmTrayState } from "../companion/driftAlarmTrayStatus";
import type { InterventionLedgerSummary } from "../companion/interventionLedger";
import {
  buildBrowserCaptureDiagnostics,
  buildDeviceSyncDebugSummary,
  buildFrontmostCaptureDiagnostics,
  isSupportedBrowserName,
  type AiDebugLogInput,
  type DeviceSyncDebugInput,
} from "../settings/debugLog";
import type { AnalysisCredentialState } from "../settings/intelligenceRouting";
import type { DriftyAiRoute, LocalAiProvider } from "../settings/localAiSetup";
import type { ManagedLocalAiStatus } from "../settings/managedLocalAiClient";

/**
 * The diagnostics a feedback report carries when the person leaves
 * "Include debug logs" checked.
 *
 * It is built from the same sources as the Dev settings debug log but keeps
 * only states, counts, error kinds and versions. Activity content (app and
 * window names, sites, URLs, titles, file paths, account identifiers) never
 * enters it, because feedback rows are stored in Supabase and the product
 * keeps raw history off the cloud. The top-level highlights name the problem
 * areas a report most likely concerns, so triage can start from one line.
 */
export const FEEDBACK_DIAGNOSTICS_SCHEMA_VERSION = 1;
/** Leaves room under the send-feedback function's 64 KB diagnostics limit. */
export const FEEDBACK_DIAGNOSTICS_MAX_CHARS = 48_000;

const RECENT_EVENT_LIMIT = 80;
const BROWSER_SUMMARY_LIMIT = 8;
const COUNT_KEY_LIMIT = 12;
const CRASH_LIMIT = 5;
const TEXT_LIMIT = 200;
const STALE_CAPTURE_SECONDS = 10 * 60;
const SITE_CONTEXT_MIN_SEGMENTS = 5;
const SITE_CONTEXT_LOW_RATIO = 0.5;
const OTHER_KEY = "other";

export type FeedbackEntryPoint = "account_menu" | "settings_sidebar";

export type FeedbackAiSetupInput = {
  readonly provider: LocalAiProvider;
  readonly driftyRoute: DriftyAiRoute;
  readonly managedLocalModelId: string;
  readonly openRouterModel: string;
  readonly openRouterFallbackModelCount: number;
  readonly hasOpenRouterKey: boolean;
  readonly openaiModel: string;
  readonly anthropicModel: string;
  readonly hasOpenAiKey: boolean;
  readonly hasAnthropicKey: boolean;
  readonly selfHostedModel: string;
  readonly selfHostedBaseUrl: string;
  readonly hasSelfHostedKey: boolean;
  readonly customEndpointCredentialState: AnalysisCredentialState;
};

export type FeedbackDiagnosticsInput = {
  readonly entryPoint: FeedbackEntryPoint;
  readonly now?: Date;
  readonly app: {
    readonly version: string;
    readonly commit: string;
    readonly channel: string | null;
    readonly platform: string;
    readonly language: string;
    readonly devModeEnabled: boolean;
    readonly installLocation: string | null;
    readonly openAtLoginStatus: string | null;
    /** The error banner the app is showing right now, if any. */
    readonly visibleError: string | null;
  };
  readonly native: NativeFeedbackDiagnostics | null;
  readonly tracker: {
    readonly status: TrackerStatus | null;
    readonly accessibilityGranted: boolean;
    readonly accessibilityRequired: boolean;
  };
  readonly todaySegments: readonly ActivitySegment[];
  readonly ai: AiDebugLogInput;
  readonly aiSetup: FeedbackAiSetupInput | null;
  /** The built-in local model's own status, read only when it is the chosen provider. */
  readonly managedLocal?: ManagedLocalAiStatus | null;
  readonly nudges: {
    readonly driftAlarmEnabled: boolean;
    readonly automaticCloseEnabled: boolean;
    readonly petModeEnabled: boolean;
    readonly quietHoursActive: boolean;
    readonly notificationsEnabled: boolean;
    readonly trayState: DriftAlarmTrayState;
  };
  readonly interventionLedger: {
    readonly last7Days: InterventionLedgerSummary;
    readonly last30Days: InterventionLedgerSummary;
  } | null;
  readonly deviceSync: DeviceSyncDebugInput | null;
  readonly recentEvents: readonly SupportJournalEntry[];
};

type CountMap = Readonly<Record<string, number>>;

type LedgerDiagnostics = {
  readonly days: number;
  readonly delivered: number;
  readonly suppressed: number;
  readonly closeAttempts: number;
  readonly closeApplied: number;
  readonly closeNotApplied: number;
  readonly petSkipped: number;
  readonly errors: number;
  readonly notAppliedReasons: CountMap;
  readonly petSkipReasons: CountMap;
  readonly petSkipDetails: CountMap;
  readonly errorCodes: CountMap;
  readonly errorDiagnostics: CountMap;
  readonly byBrowser: Readonly<Record<string, { readonly attempts: number; readonly applied: number }>>;
};

export type FeedbackDiagnostics = {
  readonly schemaVersion: typeof FEEDBACK_DIAGNOSTICS_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly entryPoint: FeedbackEntryPoint;
  readonly highlights: readonly string[];
  readonly app: {
    readonly version: string;
    readonly commit: string;
    readonly channel: string | null;
    readonly platform: string;
    readonly language: string;
    readonly devModeEnabled: boolean;
    readonly installLocation: string | null;
    readonly openAtLoginStatus: string | null;
    readonly timeZoneOffsetMinutes: number;
    readonly visibleError: string | null;
  };
  readonly system: {
    readonly osName: string;
    readonly osVersion: string | null;
    readonly arch: string;
    readonly lastWindowingError: string | null;
  } | null;
  readonly tracker: {
    readonly running: boolean | null;
    readonly paused: boolean | null;
    readonly mode: string | null;
    readonly accessibilityGranted: boolean;
    readonly accessibilityRequired: boolean;
    readonly idleDetectionAvailable: boolean | null;
    readonly lastEventAgeSeconds: number | null;
    readonly message: string | null;
  };
  readonly capture: {
    readonly todaySegments: number;
    readonly unavailableRatio: number | null;
    readonly titlelessSegments: number;
    readonly captureSourceCounts: CountMap;
    readonly captureErrorCounts: CountMap;
    readonly fallbackErrorCounts: CountMap;
    readonly browserSegments: number;
    readonly siteContextRatio: number | null;
    readonly browserAutomationDeniedSegments: number;
    readonly browserAutomationErrorCounts: CountMap;
    readonly browserHistoryFallbackSegments: number;
    readonly byBrowser: ReadonlyArray<{
      readonly browser: string;
      readonly segments: number;
      readonly siteContextRatio: number | null;
      readonly siteSourceCounts: CountMap;
      readonly automationStatusCounts: CountMap;
      readonly automationErrorCounts: CountMap;
      readonly historyStatusCounts: CountMap;
      readonly historyReasonCounts: CountMap;
    }>;
  };
  readonly ai: {
    readonly route: AiDebugLogInput["route"];
    readonly provider: string | null;
    readonly model: string | null;
    readonly fallbackModelCount: number;
    readonly endpoint: EndpointKind | null;
    readonly credential: string | null;
    readonly connection: { readonly tone: string; readonly issueKind: string | null; readonly activity: string | null };
    readonly localProvider: { readonly kind: string; readonly issueKind: string | null };
    readonly managedLocal: {
      readonly state: string;
      readonly errorKind: string | null;
      readonly installedModelCount: number;
      /** Fixed native exit summary only; arbitrary runtime error text is never included. */
      readonly message: string | null;
    } | null;
    readonly cloud: {
      readonly supabaseConfigured: boolean;
      readonly signedIn: boolean;
      readonly canUseCloudAi: boolean;
      readonly entitlementLoading: boolean;
      readonly entitlementError: string | null;
      readonly entitlement: {
        readonly plan: string | null;
        readonly status: string | null;
        readonly canUseApp: boolean;
        readonly lockedReason: string | null;
      } | null;
    };
    readonly classification: {
      readonly running: boolean;
      readonly observedFailure: boolean;
      readonly status: string | null;
      readonly failureKind: string | null;
      readonly issueKind: string | null;
      readonly serverErrorType: string | null;
      readonly quotaWindow: string | null;
      readonly usedAiProvider: boolean | null;
      readonly selectedSegments: number | null;
      readonly savedRecords: number | null;
      readonly message: string | null;
    };
    readonly usageToday: {
      readonly day: string | null;
      readonly requests: number;
      readonly llmRequests: number;
      readonly itemsRequested: number;
      readonly errors: number;
      readonly quotaErrors: number;
      readonly configErrors: number;
      readonly requestErrors: number;
      readonly parseErrors: number;
      readonly schemaErrors: number;
      readonly averageLatencyMs: number;
      readonly lastErrorType: string | null;
      readonly lastErrorStatus: number | null;
      readonly lastErrorAt: string | null;
      readonly lastErrorMessage: string | null;
    } | null;
  };
  readonly nudges: {
    readonly driftAlarmEnabled: boolean;
    readonly automaticCloseEnabled: boolean;
    readonly petModeEnabled: boolean;
    readonly quietHoursActive: boolean;
    readonly notificationsEnabled: boolean;
    readonly lastCheckAt: string | null;
    readonly lastCheckResult: string;
    readonly lastCheckReason: string | null;
    readonly automaticCloseLast7Days: LedgerDiagnostics | null;
    readonly automaticCloseLast30Days: LedgerDiagnostics | null;
  };
  readonly deviceSync: ReturnType<typeof buildDeviceSyncDebugSummary>;
  readonly crashes: ReadonlyArray<{
    readonly incidentId: string;
    readonly kind: string;
    readonly appVersion: string | null;
    readonly at: string | null;
  }>;
  readonly recentEvents: ReadonlyArray<{
    readonly event: string;
    readonly properties: Readonly<Record<string, string | boolean>>;
    readonly count: number;
    readonly firstAt: string;
    readonly lastAt: string;
  }>;
};

type EndpointKind = "unset" | "invalid" | "loopback" | "private_network" | "public";

export function buildFeedbackDiagnostics(input: FeedbackDiagnosticsInput): FeedbackDiagnostics {
  const now = input.now ?? new Date();
  const status = input.tracker.status;
  const browserCapture = buildBrowserCaptureDiagnostics("today", input.todaySegments);
  const frontmostCapture = buildFrontmostCaptureDiagnostics("today", input.todaySegments);
  const summary = input.ai.classification.summary;
  const usage = input.ai.usage.summary;
  const trayResult = input.nudges.trayState.result;
  const redactActivity = createActivityRedactor(input.todaySegments);
  const freeText = (value: string | null | undefined, limit?: number) =>
    sanitizeDiagnosticText(typeof value === "string" ? redactActivity(value) : value, limit);
  const textKey = (value: string) => freeText(value, 120);

  const diagnostics: Omit<FeedbackDiagnostics, "highlights"> = {
    schemaVersion: FEEDBACK_DIAGNOSTICS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    entryPoint: input.entryPoint,
    app: {
      version: sanitizeToken(input.app.version) ?? "unknown",
      commit: sanitizeToken(input.app.commit) ?? "unknown",
      channel: sanitizeToken(input.app.channel),
      platform: sanitizeToken(input.app.platform) ?? "unknown",
      language: sanitizeToken(input.app.language) ?? "unknown",
      devModeEnabled: input.app.devModeEnabled,
      installLocation: sanitizeToken(input.app.installLocation),
      openAtLoginStatus: sanitizeToken(input.app.openAtLoginStatus),
      timeZoneOffsetMinutes: -now.getTimezoneOffset(),
      visibleError: freeText(input.app.visibleError),
    },
    system: input.native
      ? {
          osName: sanitizeToken(input.native.osName) ?? "unknown",
          osVersion: freeText(input.native.osVersion, 80),
          arch: sanitizeToken(input.native.arch) ?? "unknown",
          lastWindowingError: freeText(input.native.lastWindowingError),
        }
      : null,
    tracker: {
      running: status ? Boolean(status.running ?? status.isRunning) : null,
      paused: status?.trackingPaused ?? null,
      mode: sanitizeToken(status?.trackerMode),
      accessibilityGranted: input.tracker.accessibilityGranted,
      accessibilityRequired: input.tracker.accessibilityRequired,
      idleDetectionAvailable: status?.idleDetectionAvailable ?? null,
      lastEventAgeSeconds: ageSeconds(status?.lastEventAt, now),
      message: freeText(status?.message),
    },
    capture: {
      todaySegments: frontmostCapture.totalSegments,
      unavailableRatio: frontmostCapture.unavailableRatio,
      titlelessSegments: frontmostCapture.titlelessSegments,
      captureSourceCounts: sanitizeCountMap(frontmostCapture.captureSourceCounts, sanitizeToken),
      captureErrorCounts: sanitizeCountMap(frontmostCapture.captureErrorCounts, textKey),
      fallbackErrorCounts: sanitizeCountMap(frontmostCapture.fallbackErrorCounts, textKey),
      browserSegments: browserCapture.browserSegments,
      siteContextRatio: browserCapture.siteContextRatio,
      browserAutomationDeniedSegments: browserCapture.browserAutomationDeniedSegments,
      browserAutomationErrorCounts: sanitizeCountMap(browserCapture.browserAutomationErrorCounts, textKey),
      browserHistoryFallbackSegments: browserCapture.browserHistoryFallbackSegments,
      byBrowser: browserCapture.byBrowser.slice(0, BROWSER_SUMMARY_LIMIT).map((browser) => ({
        browser: browserKey(browser.browserName),
        segments: browser.totalSegments,
        siteContextRatio: browser.siteContextRatio,
        siteSourceCounts: sanitizeCountMap(browser.siteSourceCounts, sanitizeToken),
        automationStatusCounts: sanitizeCountMap(browser.browserAutomationStatusCounts, sanitizeToken),
        automationErrorCounts: sanitizeCountMap(browser.browserAutomationErrorCounts, textKey),
        historyStatusCounts: sanitizeCountMap(browser.browserHistoryStatusCounts, sanitizeToken),
        historyReasonCounts: sanitizeCountMap(browser.browserHistoryReasonCounts, textKey),
      })),
    },
    ai: {
      route: input.ai.route,
      provider: input.ai.route === "local" && input.aiSetup ? input.aiSetup.provider : input.ai.route === "cloud" ? "drifty_cloud" : null,
      model: input.ai.route === "local" && input.aiSetup ? selectedLocalModel(input.aiSetup) : null,
      fallbackModelCount: input.ai.route === "local" && input.aiSetup?.provider === "openrouter_byok"
        ? Math.max(0, input.aiSetup.openRouterFallbackModelCount)
        : 0,
      endpoint: input.ai.route === "local" && input.aiSetup?.provider === "self_hosted"
        ? classifyEndpoint(input.aiSetup.selfHostedBaseUrl)
        : null,
      credential: input.ai.route === "local" && input.aiSetup ? credentialState(input.aiSetup) : null,
      connection: {
        tone: sanitizeToken(input.ai.connectionStatus.tone) ?? "neutral",
        issueKind: sanitizeToken(input.ai.connectionStatus.issueKind),
        activity: sanitizeToken(input.ai.connectionStatus.activity),
      },
      localProvider: {
        kind: input.ai.local.providerStatus.kind,
        issueKind: input.ai.local.providerStatus.kind === "failed" ? input.ai.local.providerStatus.issueKind : null,
      },
      managedLocal: input.managedLocal
        ? {
            state: sanitizeToken(input.managedLocal.state) ?? "unknown",
            errorKind: sanitizeToken(input.managedLocal.errorKind),
            installedModelCount: input.managedLocal.installedModels.length,
            message: input.managedLocal.state === "error" || input.managedLocal.errorKind
              ? managedRuntimeExitSummary(input.managedLocal.message)
              : null,
          }
        : null,
      cloud: {
        supabaseConfigured: input.ai.cloud.isSupabaseConfigured,
        signedIn: input.ai.cloud.hasRequiredAccountAuth,
        canUseCloudAi: input.ai.cloud.canUseCloudAiClassification,
        entitlementLoading: input.ai.cloud.entitlementLoading,
        entitlementError: freeText(input.ai.cloud.entitlementError),
        entitlement: input.ai.cloud.entitlement
          ? {
              plan: sanitizeToken(input.ai.cloud.entitlement.plan),
              status: sanitizeToken(input.ai.cloud.entitlement.status),
              canUseApp: input.ai.cloud.entitlement.canUseApp,
              lockedReason: sanitizeToken(input.ai.cloud.entitlement.lockedReason),
            }
          : null,
      },
      classification: {
        running: input.ai.classification.actionLoading,
        observedFailure: input.ai.classification.observedFailure,
        status: sanitizeToken(summary?.status),
        failureKind: sanitizeToken(summary?.failureKind),
        issueKind: sanitizeToken(summary?.issueKind),
        serverErrorType: sanitizeToken(summary?.serverErrorType),
        quotaWindow: sanitizeToken(summary?.quotaWindow),
        usedAiProvider: summary?.usedAiProvider ?? null,
        selectedSegments: summary ? summary.selectedSegments : null,
        savedRecords: summary ? summary.savedRecords : null,
        message: summary?.status === "error" ? freeText(summary.message) : null,
      },
      usageToday: usage
        ? {
            day: sanitizeToken(input.ai.usage.day),
            requests: usage.requests,
            llmRequests: usage.llmRequests,
            itemsRequested: usage.itemsRequested,
            errors: usage.errors,
            quotaErrors: usage.quotaErrors,
            configErrors: usage.configErrors,
            requestErrors: usage.requestErrors,
            parseErrors: usage.parseErrors,
            schemaErrors: usage.schemaErrors,
            averageLatencyMs: usage.averageLatencyMs,
            lastErrorType: sanitizeToken(usage.lastErrorType),
            lastErrorStatus: usage.lastErrorStatus,
            lastErrorAt: sanitizeTimestamp(usage.lastErrorAt),
            lastErrorMessage: freeText(usage.lastErrorMessage),
          }
        : null,
    },
    nudges: {
      driftAlarmEnabled: input.nudges.driftAlarmEnabled,
      automaticCloseEnabled: input.nudges.automaticCloseEnabled,
      petModeEnabled: input.nudges.petModeEnabled,
      quietHoursActive: input.nudges.quietHoursActive,
      notificationsEnabled: input.nudges.notificationsEnabled,
      lastCheckAt: input.nudges.trayState.checkedAt?.toISOString() ?? null,
      lastCheckResult: trayResult.kind,
      lastCheckReason: "reason" in trayResult ? sanitizeToken(trayResult.reason) ?? OTHER_KEY : null,
      automaticCloseLast7Days: input.interventionLedger ? projectLedger(input.interventionLedger.last7Days) : null,
      automaticCloseLast30Days: input.interventionLedger ? projectLedger(input.interventionLedger.last30Days) : null,
    },
    deviceSync: buildDeviceSyncDebugSummary(input.deviceSync),
    crashes: (input.native?.recentCrashes ?? []).slice(0, CRASH_LIMIT).map((crash) => ({
      incidentId: sanitizeToken(crash.incidentId) ?? OTHER_KEY,
      kind: freeText(crash.kind, 80) ?? "unknown",
      appVersion: sanitizeToken(crash.appVersion),
      at: Number.isFinite(crash.occurredAtMs) ? new Date(crash.occurredAtMs).toISOString() : null,
    })),
    recentEvents: input.recentEvents.slice(-RECENT_EVENT_LIMIT).map((entry) => ({
      event: entry.event,
      // Re-apply the analytics allowlist: stored entries are local data and
      // must not be trusted to still match the schema they were written with.
      properties: sanitizePostHogEventProperties(entry.event, entry.properties),
      count: entry.count,
      firstAt: sanitizeTimestamp(entry.firstAt) ?? entry.lastAt,
      lastAt: sanitizeTimestamp(entry.lastAt) ?? entry.firstAt,
    })),
  };

  // Highlights lead the report so the preview and a database row both open on them.
  const { schemaVersion, generatedAt, entryPoint, ...sections } = diagnostics;
  return fitFeedbackDiagnostics({
    schemaVersion,
    generatedAt,
    entryPoint,
    highlights: buildHighlights(diagnostics, input),
    ...sections,
  });
}

/**
 * Codes for the problem areas this report most likely concerns, most urgent
 * first. Each one maps to a recurring kind of report: tracking that stopped,
 * sites that are not captured, AI classification that stalls, nudges or
 * automatic close that do nothing, sync, crashes and failed updates.
 */
export function buildHighlights(
  diagnostics: Omit<FeedbackDiagnostics, "highlights">,
  input: Pick<FeedbackDiagnosticsInput, "aiSetup">,
): string[] {
  const highlights: string[] = [];
  const add = (code: string) => {
    if (!highlights.includes(code)) highlights.push(code);
  };
  const { tracker, capture, ai, nudges, deviceSync, crashes, recentEvents, system } = diagnostics;

  if (crashes.length > 0) add("recent_crash");
  if (system?.lastWindowingError) add("windowing_error");
  if (hasRecentEvent(recentEvents, "tracker_action", { action: "start", result: "error" })) add("tracker_start_failed");
  if (tracker.running === false && tracker.paused !== true) add("tracker_not_running");
  if (tracker.paused === true) add("tracker_paused");
  if (tracker.mode === "degraded") add("tracker_degraded");
  if (tracker.accessibilityRequired && !tracker.accessibilityGranted) add("accessibility_missing");
  if (tracker.running === true && tracker.paused !== true && (tracker.lastEventAgeSeconds ?? 0) > STALE_CAPTURE_SECONDS) add("capture_stale");
  if (capture.browserAutomationDeniedSegments > 0) add("browser_automation_denied");
  if (capture.browserSegments >= SITE_CONTEXT_MIN_SEGMENTS && (capture.siteContextRatio ?? 1) < SITE_CONTEXT_LOW_RATIO) add("site_context_missing");

  if (ai.route === "disabled") add("ai_disabled");
  if (ai.connection.issueKind) add(`ai_issue:${ai.connection.issueKind}`);
  if (ai.localProvider.issueKind) add(`local_ai_failed:${ai.localProvider.issueKind}`);
  if (ai.classification.status === "error" || ai.classification.observedFailure) add("ai_classification_error");
  if (hasRecentEvent(recentEvents, "ai_classification_run", { result: "error" })) add("ai_runs_failed_recently");
  if ((ai.usageToday?.errors ?? 0) > 0) add("ai_usage_errors_today");
  if (ai.credential === "missing" || ai.credential === "error") add(`ai_credential_${ai.credential}`);
  if (ai.endpoint === "invalid" || ai.endpoint === "unset") add(`ai_endpoint_${ai.endpoint}`);
  if (ai.cloud.entitlement && !ai.cloud.entitlement.canUseApp) add("entitlement_locked");
  if (hasRecentEvent(recentEvents, "local_model_setup", { phase: "download_failed" })) add("local_model_download_failed");

  if (!nudges.driftAlarmEnabled) add("drift_alarm_off");
  if (nudges.driftAlarmEnabled && !nudges.automaticCloseEnabled) add("automatic_close_off");
  if (nudges.quietHoursActive) add("quiet_hours_active");
  if (!nudges.notificationsEnabled) add("notifications_off");
  if ((nudges.automaticCloseLast7Days?.errors ?? 0) > 0) add("automatic_close_errors_7d");
  if ((nudges.automaticCloseLast7Days?.closeNotApplied ?? 0) > 0) add("automatic_close_not_applied_7d");

  if (deviceSync?.runtime.error.present) add("device_sync_error");
  if (hasRecentEvent(recentEvents, "app_update", { update_step: "prepare_failed" })
    || hasRecentEvent(recentEvents, "app_update", { update_step: "install_failed" })) add("update_failed");
  if (diagnostics.app.visibleError) add("app_error_visible");
  if (recentEvents.some((entry) => entry.event === "app_error")) add("app_error_recent");
  if (diagnostics.app.installLocation === "translocated" || diagnostics.app.installLocation === "removable_volume") {
    add(`install_location:${diagnostics.app.installLocation}`);
  }
  if (input.aiSetup === null && ai.route === "local") add("ai_setup_unknown");
  return highlights;
}

/** Trims the oldest recent events, then per-browser detail, until the report fits. */
export function fitFeedbackDiagnostics(
  diagnostics: FeedbackDiagnostics,
  maxChars = FEEDBACK_DIAGNOSTICS_MAX_CHARS,
): FeedbackDiagnostics {
  let fitted = diagnostics;
  while (JSON.stringify(fitted).length > maxChars && fitted.recentEvents.length > 0) {
    fitted = { ...fitted, recentEvents: fitted.recentEvents.slice(Math.min(10, fitted.recentEvents.length)) };
  }
  if (JSON.stringify(fitted).length > maxChars) {
    fitted = { ...fitted, capture: { ...fitted.capture, byBrowser: [] } };
  }
  return fitted;
}


const URL_PATTERN = /\b[a-z][a-z0-9+.-]{1,31}:\/\/[^\s<>"')]+/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAC_HOME_PATTERN = /\/(Users|home)\/[^/\s"']+/g;
const WINDOWS_HOME_PATTERN = /[A-Z]:\\Users\\[^\\\s"']+/gi;
const SECRET_PATTERN = /\b(?:sk|pk|rk|sbp|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{6,}|\b[A-Za-z0-9_-]{32,}\b/g;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,79}$/;

/**
 * Free text from errors and providers, with anything that could identify the
 * person or their activity replaced: URLs, email addresses, home-directory
 * paths and long secret-like tokens. Truncated so an echoed request cannot
 * carry much.
 */
export function sanitizeDiagnosticText(value: string | null | undefined, limit = TEXT_LIMIT): string | null {
  if (typeof value !== "string") return null;
  const redacted = value
    .replace(URL_PATTERN, "[url]")
    .replace(EMAIL_PATTERN, "[email]")
    .replace(MAC_HOME_PATTERN, "~")
    .replace(WINDOWS_HOME_PATTERN, "~")
    .replace(SECRET_PATTERN, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!redacted) return null;
  return redacted.length > limit ? `${redacted.slice(0, limit - 1)}…` : redacted;
}

/** Short machine values (versions, states, codes). Anything else becomes null. */
export function sanitizeToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !TOKEN_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * Native status reconciliation owns this sentence. Keep its phase and numeric
 * exit status, never arbitrary error text: paths can contain spaces, quotes,
 * or newlines, so trying to remove them from a free-form message is unsafe.
 * Other failures still have state/errorKind above.
 */
function managedRuntimeExitSummary(value: string): string | null {
  const summary = /^Managed local AI runtime (?:exited(?: before it became ready)?|stopped unexpectedly) \((?:exit code: (?:0x[0-9a-f]{1,8}|-?\d{1,10})|signal: \d{1,3}(?: \(SIG[A-Z0-9]{1,12}\))?)\)\./i.exec(value);
  return summary?.[0] ?? null;
}

const ACTIVITY_PLACEHOLDER = "[activity]";
const MIN_ACTIVITY_TERM_LENGTH = 3;
const MAX_ACTIVITY_TERMS = 2_000;

/**
 * Error text can quote what the person was doing ("could not read the tab
 * for …"). Every app, window, site and video name the app holds for today is
 * removed from free text before the generic redaction runs. Known browser
 * names stay, because they are product vocabulary and name the capture path.
 */
export function createActivityRedactor(segments: readonly ActivitySegment[]): (value: string) => string {
  const terms = new Set<string>();
  for (const segment of segments) {
    for (const value of [
      segment.appName,
      segment.bundleId,
      segment.windowTitle,
      segment.browserName,
      segment.siteDomain,
      segment.siteTitle,
      segment.siteUrl,
      segment.youtubeTitle,
      segment.youtubeChannelName,
    ]) {
      const term = value?.trim().toLowerCase();
      if (term && term.length >= MIN_ACTIVITY_TERM_LENGTH && !isSupportedBrowserName(value?.trim())) terms.add(term);
    }
  }
  const ordered = [...terms].sort((left, right) => right.length - left.length).slice(0, MAX_ACTIVITY_TERMS);
  if (ordered.length === 0) return (value) => value;
  return (value) => {
    let result = value;
    for (const term of ordered) {
      let index = result.toLowerCase().indexOf(term);
      while (index !== -1) {
        result = result.slice(0, index) + ACTIVITY_PLACEHOLDER + result.slice(index + term.length);
        index = result.toLowerCase().indexOf(term, index + ACTIVITY_PLACEHOLDER.length);
      }
    }
    return result;
  };
}

function sanitizeCountMap(counts: CountMap, sanitizeKey: (key: string) => string | null): CountMap {
  const merged: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts)) {
    const safeKey = sanitizeKey(key) ?? OTHER_KEY;
    merged[safeKey] = (merged[safeKey] ?? 0) + count;
  }
  const ranked = Object.entries(merged).sort((left, right) => right[1] - left[1]);
  const kept = ranked.slice(0, COUNT_KEY_LIMIT);
  const rest = ranked.slice(COUNT_KEY_LIMIT).reduce((total, [, count]) => total + count, 0);
  const result: Record<string, number> = Object.fromEntries(kept);
  if (rest > 0) result[OTHER_KEY] = (result[OTHER_KEY] ?? 0) + rest;
  return result;
}

function browserKey(value: string | null | undefined): string {
  return isSupportedBrowserName(value) && value ? value : "other_browser";
}

function projectLedger(summary: InterventionLedgerSummary): LedgerDiagnostics {
  const byBrowser: Record<string, { attempts: number; applied: number }> = {};
  for (const [browser, counts] of Object.entries(summary.byBrowser)) {
    const key = browserKey(browser);
    const current = byBrowser[key] ?? { attempts: 0, applied: 0 };
    byBrowser[key] = { attempts: current.attempts + counts.attempts, applied: current.applied + counts.applied };
  }
  return {
    days: summary.days,
    delivered: summary.delivered,
    suppressed: summary.suppressed,
    closeAttempts: summary.closeAttempts,
    closeApplied: summary.closeApplied,
    closeNotApplied: summary.closeNotApplied,
    petSkipped: summary.petSkipped,
    errors: summary.errors,
    notAppliedReasons: sanitizeCountMap(summary.notAppliedDiagnostics, sanitizeToken),
    petSkipReasons: sanitizeCountMap(summary.petSkipReasons, sanitizeToken),
    petSkipDetails: sanitizeCountMap(summary.petSkipDetails, sanitizeToken),
    errorCodes: sanitizeCountMap(summary.errorCodes, sanitizeToken),
    errorDiagnostics: sanitizeCountMap(summary.errorDiagnostics, sanitizeToken),
    byBrowser,
  };
}

function selectedLocalModel(setup: FeedbackAiSetupInput): string | null {
  switch (setup.provider) {
    case "managed_local":
      return sanitizeDiagnosticText(setup.managedLocalModelId, 80);
    case "openrouter_byok":
      return sanitizeDiagnosticText(setup.openRouterModel, 80);
    case "openai":
      return sanitizeDiagnosticText(setup.openaiModel, 80);
    case "anthropic":
      return sanitizeDiagnosticText(setup.anthropicModel, 80);
    case "self_hosted":
      return sanitizeDiagnosticText(setup.selfHostedModel, 80);
    default:
      return null;
  }
}

function credentialState(setup: FeedbackAiSetupInput): string | null {
  switch (setup.provider) {
    case "managed_local":
      return null;
    case "openrouter_byok":
      return setup.hasOpenRouterKey ? "present" : "missing";
    case "openai":
      return setup.hasOpenAiKey ? "present" : "missing";
    case "anthropic":
      return setup.hasAnthropicKey ? "present" : "missing";
    case "self_hosted":
      if (setup.hasSelfHostedKey) return "present";
      return setup.customEndpointCredentialState === "idle" || setup.customEndpointCredentialState === "ready"
        ? "none"
        : setup.customEndpointCredentialState;
    default:
      return null;
  }
}

/** Where a custom endpoint points, without its address. */
export function classifyEndpoint(value: string): EndpointKind {
  const trimmed = value.trim();
  if (!trimmed) return "unset";
  let host: string;
  try {
    host = new URL(trimmed).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "invalid";
  }
  if (!host) return "invalid";
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost") || /^127\./.test(host)) return "loopback";
  if (
    /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
    || /^169\.254\./.test(host)
    || /^f[cd][0-9a-f]{2}:/.test(host)
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".ts.net")
    || !host.includes(".")
  ) return "private_network";
  return "public";
}

function hasRecentEvent(
  entries: FeedbackDiagnostics["recentEvents"],
  event: string,
  match: Readonly<Record<string, string>>,
): boolean {
  return entries.some((entry) => entry.event === event
    && Object.entries(match).every(([key, value]) => entry.properties[key] === value));
}

function ageSeconds(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.round((now.getTime() - at) / 1000));
}

function sanitizeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}
