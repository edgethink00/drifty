import type { WatcherPeekEvent, WatcherPeekResponse } from "./watcherPeekTypes";
import { trackerClient } from "../../lib/api/trackerClient";
import { categorizeActivity, classifyActivity, computeCurrentFocusStrikeSeconds, computePreservedFocusStrikeSeconds } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, ClassificationOptions, CurrentActivitySnapshot, ProductivityLabel } from "@drifty/domain";
import { isProductivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { buildDefaultDriftAlarmCopy, buildDriftNotificationCopy, type DriftAlarmCopySettingsValue } from "./driftAlarmCopy";
import type { DisplayLanguage } from "../localization/languagePreference";
import { resolveWatcherCurrentSegment } from "./watcherCurrentSegment";

export type WatcherSnapshot = Omit<WatcherPeekEvent, "id" | "slotIndex"> & {
  /** Opaque local revision; it contains no raw app, site, or title text. */
  readonly surfaceRevision?: number;
};

/**
 * Produces a local-only change token for the visible app/window surface. The
 * pet webview needs to know that AX geometry may have changed, but it does not
 * need the raw bundle id, window title, or site metadata that produced it.
 */
export function buildActivitySurfaceRevision(current: CurrentActivitySnapshot): number {
  const identity = [
    current.bundleId ?? "",
    current.appName,
    current.windowTitle ?? "",
    current.browserName ?? "",
    current.siteDomain ?? "",
  ].join("\u001f");
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type WatcherDelayRange = {
  minMs: number;
  maxMs: number;
};

export type WatcherMode = "periodic" | "drift_only";

export type DriftReminderState = {
  identity: string;
  thresholdSeconds: number;
};

export const WATCHER_PEEK_STORAGE_KEY = "drifty.companion.watcherPeek";

export const WATCHER_MODE_STORAGE_KEY = "drifty.companion.watcherMode";

export const WATCHER_PERIODIC_MIN_STORAGE_KEY = "drifty.companion.periodicMinMinutes";

export const WATCHER_PERIODIC_MAX_STORAGE_KEY = "drifty.companion.periodicMaxMinutes";

export const WATCHER_RESPONSE_STORAGE_KEY = "drifty.companion.watcherResponses";

export const DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES = { min: 10, max: 30 };

export const WATCHER_PERIODIC_MIN_LIMIT_MINUTES = 10;

export const WATCHER_PERIODIC_MAX_LIMIT_MINUTES = 240;

export const WATCHER_INITIAL_PEEK_DELAY_MS = 5_000;

export const WATCHER_DRIFT_ONLY_CHECK_DELAY_MS = 10_000;

export const WATCHER_DRIFT_REMINDER_THRESHOLDS_SECONDS = [10, 5 * 60, 30 * 60, 60 * 60, 2 * 60 * 60] as const;

export const WATCHER_STALE_EVENT_RECOVERY_MS = 30_000;

export function getDefaultWatcherSnapshot(): WatcherSnapshot {
  return {
    productivity: "neutral",
    category: "unknown",
    contextLabel: "the current session",
    durationLabel: "a moment",
    durationSeconds: 0,
    focusSessionKind: "settled",
    driftPattern: "first",
    driftReminderElapsedSeconds: null,
    recentWatcherResponse: getRecentWatcherResponse()?.response ?? null,
    minutesSinceLastWatcher: getMinutesSinceLastWatcher(),
    focusSecondsToday: 0,
    currentHourFocusSeconds: 0,
    focusStrikeSeconds: null,
    preservedFocusStrikeSeconds: null,
  };
}

export function getLatestWatcherSegment(segments: ActivitySegment[]): ActivitySegment | null {
  if (segments.length === 0) return null;
  let latestSegment = segments[0];
  let latestEndedAt = new Date(latestSegment.endedAt).getTime();

  for (const segment of segments.slice(1)) {
    const endedAt = new Date(segment.endedAt).getTime();
    if (endedAt > latestEndedAt) {
      latestSegment = segment;
      latestEndedAt = endedAt;
    }
  }

  return latestSegment;
}

export function buildWatcherSnapshot(segments: ActivitySegment[], classificationOptions?: ClassificationOptions): WatcherSnapshot {
  const segment = getLatestWatcherSegment(segments);
  if (!segment) return getDefaultWatcherSnapshot();
  const { category, productivity } = classifyActivity(segment, classificationOptions);
  const recentWatcherResponse = getRecentWatcherResponse();
  const focusSecondsToday = sumProductivitySeconds(segments, "focus", classificationOptions);
  const currentHourFocusSeconds = sumCurrentHourFocusSeconds(segments, classificationOptions);

  return {
    productivity,
    category,
    contextLabel: getWatcherContextLabel(segment, category),
    durationLabel: formatCompactDurationFromSeconds(segment.durationSeconds),
    durationSeconds: segment.durationSeconds,
    focusSessionKind: getWatcherFocusSessionKind(segment, recentWatcherResponse?.productivity ?? null),
    driftPattern: getWatcherDriftPattern(segment, recentWatcherResponse),
    driftReminderElapsedSeconds: null,
    recentWatcherResponse: recentWatcherResponse?.response ?? null,
    minutesSinceLastWatcher: recentWatcherResponse ? Math.max(0, Math.round((Date.now() - new Date(recentWatcherResponse.respondedAt).getTime()) / 60000)) : null,
    focusSecondsToday,
    currentHourFocusSeconds,
    focusStrikeSeconds: computeCurrentFocusStrikeSeconds(segments, segment, classificationOptions),
    preservedFocusStrikeSeconds: computePreservedFocusStrikeSeconds(segments, segment, classificationOptions),
  };
}

export async function resolveWatcherSnapshot(segments: ActivitySegment[], driftReminderElapsedSeconds: number | null = null, classificationOptions?: ClassificationOptions): Promise<WatcherSnapshot> {
  try {
    const current = await trackerClient.getCurrentSnapshot();
    if (!current) return getDefaultWatcherSnapshot();
    return buildWatcherSnapshotFromCurrent(current, segments, driftReminderElapsedSeconds, classificationOptions);
  } catch {
    return getDefaultWatcherSnapshot();
  }
}

/**
 * Classify the frontmost app for overlay posture.
 *
 * Reuse the latest local segment only when its captured activity still matches
 * `current`. This preserves its AI/manual verdict without inheriting a verdict
 * from a different video, window, device, or historical dashboard day.
 */
export function buildLiveWatcherSnapshot(
  current: CurrentActivitySnapshot,
  todaySegments: ActivitySegment[],
  classificationOptions?: ClassificationOptions,
  driftReminderElapsedSeconds: number | null = null,
): WatcherSnapshot {
  const active = resolveWatcherCurrentSegment(current, todaySegments, CURRENT_SNAPSHOT_FRESHNESS_SECONDS);
  const liveIdentity = active?.segment ?? currentSnapshotToSegment(current, 0);
  return {
    ...buildCurrentWatcherSnapshot(
      liveIdentity,
      todaySegments,
      driftReminderElapsedSeconds,
      {
        includeAiClassifications: classificationOptions?.includeAiClassifications,
        includeBuiltInHeuristics: classificationOptions?.includeBuiltInHeuristics,
        builtInHeuristicsUnavailableSince: classificationOptions?.builtInHeuristicsUnavailableSince,
        rules: classificationOptions?.rules,
        fallbackCandidates: [liveIdentity],
      },
      active?.uncapturedSeconds ?? 0,
    ),
    surfaceRevision: buildActivitySurfaceRevision(current),
  };
}

export function snapshotObservedAtMs(snapshot: { readonly observedAt?: string | null } | null | undefined): number | null {
  if (!snapshot?.observedAt) return null;
  const observedAtMs = Date.parse(snapshot.observedAt);
  return Number.isFinite(observedAtMs) ? observedAtMs : null;
}

export function shouldReplacePetModeLiveSnapshot(
  incomingObservedAtMs: number | null,
  currentObservedAtMs: number,
): boolean {
  return incomingObservedAtMs !== null && incomingObservedAtMs >= currentObservedAtMs;
}

export function buildWatcherSnapshotFromCurrent(current: CurrentActivitySnapshot, segments: ActivitySegment[], driftReminderElapsedSeconds: number | null = null, classificationOptions?: ClassificationOptions): WatcherSnapshot {
  const timing = getCurrentSnapshotTiming(current, segments);
  const segment = currentSnapshotToSegment(current, timing.durationSeconds);
  return buildCurrentWatcherSnapshot(segment, segments, driftReminderElapsedSeconds, classificationOptions, timing.uncapturedSeconds);
}

function buildCurrentWatcherSnapshot(
  segment: ActivitySegment,
  segments: ActivitySegment[],
  driftReminderElapsedSeconds: number | null,
  classificationOptions: ClassificationOptions | undefined,
  uncapturedSeconds: number,
): WatcherSnapshot {
  const { category, productivity } = classifyActivity(segment, {
    ...classificationOptions,
    fallbackCandidates: [segment, ...(classificationOptions?.fallbackCandidates ?? segments)],
  });
  const recentWatcherResponse = getRecentWatcherResponse();
  const uncapturedFocusSeconds = productivity === "focus" ? uncapturedSeconds : 0;
  const focusSecondsToday = sumProductivitySeconds(segments, "focus", classificationOptions) + uncapturedFocusSeconds;
  const currentHourFocusSeconds = sumCurrentHourFocusSeconds(segments, classificationOptions) + uncapturedFocusSeconds;
  // A matched live segment extends a stored row with the same ID; replace it
  // so the run calculators see the current activity exactly once.
  const currentSegments = [...segments.filter((candidate) => candidate.id !== segment.id), segment];
  const preservedFocusStrikeSeconds = computePreservedFocusStrikeSeconds(currentSegments, segment, classificationOptions);
  const focusStrikeSeconds = computeCurrentFocusStrikeSeconds(currentSegments, segment, classificationOptions);

  return {
    productivity,
    category,
    contextLabel: getWatcherContextLabel(segment, category),
    durationLabel: segment.durationSeconds > 0 ? formatCompactDurationFromSeconds(segment.durationSeconds) : "just now",
    durationSeconds: segment.durationSeconds,
    focusSessionKind: getWatcherFocusSessionKind(segment, recentWatcherResponse?.productivity ?? null),
    driftPattern: getWatcherDriftPattern(segment, recentWatcherResponse),
    driftReminderElapsedSeconds,
    recentWatcherResponse: recentWatcherResponse?.response ?? null,
    minutesSinceLastWatcher: recentWatcherResponse ? Math.max(0, Math.round((Date.now() - new Date(recentWatcherResponse.respondedAt).getTime()) / 60000)) : null,
    focusSecondsToday,
    currentHourFocusSeconds,
    focusStrikeSeconds,
    preservedFocusStrikeSeconds,
  };
}

export function currentSnapshotToSegment(current: CurrentActivitySnapshot, durationSeconds: number): ActivitySegment {
  const endedAt = new Date(current.observedAt).getTime();
  const startedAt = Number.isFinite(endedAt) ? new Date(endedAt - durationSeconds * 1000).toISOString() : current.observedAt;

  return {
    id: `current:${current.observedAt}`,
    startedAt,
    endedAt: current.observedAt,
    durationSeconds,
    appName: current.appName,
    bundleId: current.bundleId,
    windowTitle: current.windowTitle,
    browserName: current.browserName,
    siteDomain: current.siteDomain,
    siteTitle: current.siteTitle,
    siteUrl: current.siteUrl,
    youtubeVideoId: current.youtubeVideoId,
    youtubePlaylistId: current.youtubePlaylistId,
    youtubeIsShorts: current.youtubeIsShorts,
    siteSource: current.siteSource,
    browserAutomationStatus: current.browserAutomationStatus,
    browserAutomationError: current.browserAutomationError,
    browserHistoryStatus: current.browserHistoryStatus,
    browserHistoryReason: current.browserHistoryReason,
    browserHistoryDatabaseFound: current.browserHistoryDatabaseFound,
    browserHistoryProfileCount: current.browserHistoryProfileCount,
    browserHistoryCandidateCount: current.browserHistoryCandidateCount,
    browserHistoryErrorCount: current.browserHistoryErrorCount,
    frontmostCaptureSource: current.frontmostCaptureSource,
    frontmostCaptureError: current.frontmostCaptureError,
    frontmostFallbackError: current.frontmostFallbackError,
    platform: "macos",
    source: current.source,
  };
}

export type CurrentSnapshotTiming = {
  durationSeconds: number;
  uncapturedSeconds: number;
};

export const CURRENT_SNAPSHOT_FRESHNESS_SECONDS = 90;

export function getCurrentSnapshotTiming(current: CurrentActivitySnapshot, segments: ActivitySegment[]): CurrentSnapshotTiming {
  const latestSegment = getLatestWatcherSegment(segments);
  if (!latestSegment) return { durationSeconds: 0, uncapturedSeconds: 0 };
  if (activitySegmentIdentity(latestSegment) !== currentSnapshotIdentity(current)) return { durationSeconds: 0, uncapturedSeconds: 0 };

  const observedAt = new Date(current.observedAt).getTime();
  const endedAt = new Date(latestSegment.endedAt).getTime();
  const elapsedSeconds = Number.isFinite(observedAt) && Number.isFinite(endedAt) ? Math.max(0, Math.round((observedAt - endedAt) / 1000)) : 0;
  if (elapsedSeconds > CURRENT_SNAPSHOT_FRESHNESS_SECONDS) return { durationSeconds: 0, uncapturedSeconds: 0 };

  return {
    durationSeconds: latestSegment.durationSeconds + elapsedSeconds,
    uncapturedSeconds: elapsedSeconds,
  };
}

export function currentSnapshotIdentity(current: CurrentActivitySnapshot): string {
  return [
    current.bundleId ?? current.appName,
    current.appName,
    current.siteDomain ?? current.siteTitle ?? current.windowTitle ?? "",
  ].join("\u001f");
}

export function activitySegmentIdentity(segment: ActivitySegment): string {
  return [
    segment.bundleId ?? segment.appName,
    segment.appName,
    segment.siteDomain ?? segment.siteTitle ?? segment.windowTitle ?? "",
  ].join("\u001f");
}

export type StoredWatcherResponse = {
  respondedAt: string;
  response: WatcherPeekResponse;
  productivity: ProductivityLabel;
  durationLabel: string;
};

export function getRecentWatcherResponse(): StoredWatcherResponse | null {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = window.localStorage.getItem(WATCHER_RESPONSE_STORAGE_KEY);
    const responses: unknown = rawValue ? JSON.parse(rawValue) : [];
    if (!Array.isArray(responses)) return null;
    const latest = responses[responses.length - 1] as Partial<StoredWatcherResponse> | undefined;
    if (!latest?.respondedAt || !isWatcherPeekResponse(latest.response) || !isProductivityLabel(latest.productivity)) return null;
    return {
      respondedAt: latest.respondedAt,
      response: latest.response,
      productivity: latest.productivity,
      durationLabel: typeof latest.durationLabel === "string" ? latest.durationLabel : "",
    };
  } catch {
    return null;
  }
}

export function getMinutesSinceLastWatcher(): number | null {
  const recent = getRecentWatcherResponse();
  if (!recent) return null;
  const respondedAt = new Date(recent.respondedAt).getTime();
  if (Number.isNaN(respondedAt)) return null;
  return Math.max(0, Math.round((Date.now() - respondedAt) / 60000));
}

export function getWatcherFocusSessionKind(segment: ActivitySegment, recentProductivity: ProductivityLabel | null): WatcherSnapshot["focusSessionKind"] {
  if (recentProductivity === "drift") return "recovered";
  if (segment.durationSeconds < 5 * 60) return "just_started";
  if (segment.durationSeconds >= 45 * 60) return "deep";
  return "settled";
}

export function getWatcherDriftPattern(segment: ActivitySegment, recent: StoredWatcherResponse | null): WatcherSnapshot["driftPattern"] {
  if (recent?.response === "snooze") return "after_snooze";
  if (recent?.productivity === "drift") return "repeated";
  if (segment.durationSeconds >= 15 * 60) return "long";
  return "first";
}

export function sumProductivitySeconds(segments: ActivitySegment[], productivity: ProductivityLabel, classificationOptions?: ClassificationOptions): number {
  return segments.reduce((total, segment) => total + (categorizeActivity(segment, classificationOptions) === productivity ? segment.durationSeconds : 0), 0);
}

export function sumCurrentHourFocusSeconds(segments: ActivitySegment[], classificationOptions?: ClassificationOptions): number {
  const now = new Date();
  const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0).getTime();
  const hourEnd = hourStart + 60 * 60 * 1000;

  return segments.reduce((total, segment) => {
    if (categorizeActivity(segment, classificationOptions) !== "focus") return total;
    const start = new Date(segment.startedAt).getTime();
    const end = new Date(segment.endedAt).getTime();
    const overlap = Math.max(0, Math.min(end, hourEnd) - Math.max(start, hourStart));
    return total + Math.round(overlap / 1000);
  }, 0);
}

export function isWatcherPeekResponse(value: unknown): value is WatcherPeekResponse {
  return (
    value === "return"
    || value === "snooze"
    || value === "dismiss"
  );
}

export function getWatcherContextLabel(segment: ActivitySegment, category: ActivityCategory): string {
  const appName = segment.appName.trim();
  if (segment.siteDomain?.trim()) return segment.siteDomain.trim();
  if (segment.siteTitle?.trim()) return segment.siteTitle.trim();
  if (appName && appName.toLowerCase() !== "unknown" && appName.toLowerCase() !== "unavailable") return appName;
  if (segment.windowTitle?.trim()) return segment.windowTitle.trim();
  if (category === "workspace") return "your work app";
  if (category === "communication") return "your messages";
  if (category === "utility") return "a utility app";
  return "this session";
}

export function getWatcherScheduleDelayMs(mode: WatcherMode, minMinutes: number, maxMinutes: number): number {
  if (mode === "drift_only") return WATCHER_DRIFT_ONLY_CHECK_DELAY_MS;
  const minMs = minMinutes * 60_000;
  const maxMs = Math.max(minMs, maxMinutes * 60_000);
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

export async function showDueDriftWatcherPeek(
  segments: ActivitySegment[],
  showWatcherPeek: (force?: boolean, reminderThresholdSeconds?: number | null) => void,
  driftReminderStateRef: { current: DriftReminderState | null },
  classificationOptions?: ClassificationOptions,
): Promise<void> {
  const snapshot = await resolveWatcherSnapshot(segments, null, classificationOptions);
  if (snapshot.productivity !== "drift") {
    driftReminderStateRef.current = null;
    return;
  }

  const thresholdSeconds = getDueDriftReminderThreshold(snapshot.durationSeconds);
  if (thresholdSeconds === null) return;

  const identity = `${snapshot.category}\u001f${snapshot.contextLabel}`;
  const previous = driftReminderStateRef.current;
  if (previous?.identity === identity && previous.thresholdSeconds >= thresholdSeconds) return;

  driftReminderStateRef.current = { identity, thresholdSeconds };
  showWatcherPeek(false, thresholdSeconds);
}

export function getDueDriftReminderThreshold(durationSeconds: number): number | null {
  let dueThreshold: number | null = null;
  for (const threshold of WATCHER_DRIFT_REMINDER_THRESHOLDS_SECONDS) {
    if (durationSeconds >= threshold) dueThreshold = threshold;
  }
  return dueThreshold;
}

export function persistWatcherResponse(event: WatcherPeekEvent, response: WatcherPeekResponse): void {
  if (typeof window === "undefined") return;

  try {
    const rawValue = window.localStorage.getItem(WATCHER_RESPONSE_STORAGE_KEY);
    const existingResponses: unknown = rawValue ? JSON.parse(rawValue) : [];
    const responses = Array.isArray(existingResponses) ? existingResponses.slice(-19) : [];
    responses.push({
      respondedAt: new Date().toISOString(),
      response,
      productivity: event.productivity,
      durationLabel: event.durationLabel,
    });
    window.localStorage.setItem(WATCHER_RESPONSE_STORAGE_KEY, JSON.stringify(responses));
  } catch {
    // The watcher is a prototype surface; storage failures should not affect tracking.
  }
}

export function resolveInitialWatcherPeekEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const savedValue = window.localStorage.getItem(WATCHER_PEEK_STORAGE_KEY);
  if (savedValue === null) return false;
  return savedValue === "1";
}

export function resolveInitialWatcherMode(): WatcherMode {
  if (typeof window === "undefined") return "periodic";
  return window.localStorage.getItem(WATCHER_MODE_STORAGE_KEY) === "drift_only" ? "drift_only" : "periodic";
}

export function resolveInitialWatcherPeriodicMinutes(boundary: "min" | "max"): number {
  if (typeof window === "undefined") return DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES[boundary];
  const key = boundary === "min" ? WATCHER_PERIODIC_MIN_STORAGE_KEY : WATCHER_PERIODIC_MAX_STORAGE_KEY;
  return normalizeWatcherPeriodicMinutes(window.localStorage.getItem(key), DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES[boundary]);
}

export function normalizeWatcherPeriodicMinutes(value: string | null, fallback: number): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return fallback;
  if (parsedValue < WATCHER_PERIODIC_MIN_LIMIT_MINUTES) return fallback;
  return Math.min(WATCHER_PERIODIC_MAX_LIMIT_MINUTES, Math.max(WATCHER_PERIODIC_MIN_LIMIT_MINUTES, Math.round(parsedValue)));
}

export async function sendDriftNotification(
  segment: ActivitySegment,
  copySettings: DriftAlarmCopySettingsValue = buildDefaultDriftAlarmCopy(),
  language: DisplayLanguage = "en",
) {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (getCurrentWindow().label !== "main") return;

    const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
    let hasPermission = await isPermissionGranted();
    if (!hasPermission) {
      const permission = await requestPermission();
      hasPermission = permission === "granted";
    }

    if (!hasPermission) return;

    const place = segment.siteDomain ?? segment.appName;
    const copy = buildDriftNotificationCopy(copySettings, {
      driftDurationLabel: formatLocalizedCompactDurationFromSeconds(segment.durationSeconds, language),
      place,
    });
    sendNotification({
      title: copy.title,
      body: copy.body,
    });
  } catch {
    // Notifications are a convenience; tracking should continue even if macOS denies permission.
  }
}
