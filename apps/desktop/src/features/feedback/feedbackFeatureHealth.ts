import type { ScreenContextStatus, TrackerStatus } from "@drifty/domain";
import type { MemoryStatus } from "../screen-context/memoryWire";

export type FeedbackRuntime = "desktop" | "browser" | "unknown";
export type FeedbackTrackerInput = {
  readonly status: TrackerStatus | null;
  readonly cachedStatus?: TrackerStatus | null;
  readonly statusSource?: "fresh" | "cached" | "unavailable" | "unsupported";
  readonly accessibilityGranted: boolean;
  readonly accessibilityRequired: boolean;
};

/** A browser/failed IPC placeholder is not an observation of a stopped daemon
 * or a denied permission. Retain cached UI state separately to diagnose stale
 * rendering without presenting it as the newly collected native state. */
export function trackerHealth(input: FeedbackTrackerInput, runtime: FeedbackRuntime, now: number) {
  const supported = runtime !== "browser";
  const status = supported && input.status && (input.status.trackerMode !== "unavailable"
    || input.status.statusIssue === "databaseUnavailable") ? input.status : null;
  const cached = supported && input.cachedStatus && input.cachedStatus.trackerMode !== "unavailable" ? input.cachedStatus : null;
  const running = (value: TrackerStatus | null | undefined) => value?.running ?? value?.isRunning ?? null;
  const source = !supported ? "unsupported" : !status ? "unavailable" : input.statusSource ?? "cached";
  // Native failure envelopes use false placeholders without inspecting a
  // process or asking Accessibility. Keep the failure, not those placeholders.
  const stateObserved = status !== null && status.statusIssue !== "databaseUnavailable" && status.trackerMode !== "degraded";
  const idleSeconds = status?.idleDetectionAvailable === true && typeof status.idleSeconds === "number"
    && Number.isFinite(status.idleSeconds) && status.idleSeconds >= 0
    ? Math.min(604_800, Math.floor(status.idleSeconds)) : null;
  return {
    running: stateObserved ? running(status) : null,
    paused: status?.trackingPaused ?? null, mode: status?.statusIssue === "databaseUnavailable" ? null : status?.trackerMode ?? null,
    statusSource: source, statusIssue: status?.statusIssue ?? null,
    accessibilityGranted: stateObserved ? input.accessibilityGranted : null,
    accessibilityRequired: supported ? input.accessibilityRequired : null,
    idleDetectionAvailable: status?.idleDetectionAvailable ?? null, idleSeconds,
    lastEventAgeSeconds: status?.lastEventAt && Number.isFinite(Date.parse(status.lastEventAt))
      ? age(Date.parse(status.lastEventAt), now) : null,
    message: status?.message ? "present" : null,
    uiRunning: running(cached), uiMode: cached?.trackerMode ?? null,
  };
}
export function screenHealth(status: ScreenContextStatus | null, now: number) {
  return status ? {
    enabled: status.preferences.enabled, replayEnabled: status.preferences.replayEnabled, ocrEnabled: status.preferences.ocrEnabled,
    helperInstalled: status.helperInstalled, captureEnabled: status.captureEnabled, globalPaused: status.globalPaused,
    paused: status.paused, running: status.running, preparing: status.preparing, ocrSupported: status.ocrSupported,
    preferencesInvalid: status.preferencesInvalid, activityCleanupPending: status.activityCleanupPending ?? false,
    accepted: status.accepted, dropped: status.dropped, lastFailure: status.lastFailure,
    lastAcceptedAgeSeconds: age(status.lastAcceptedAtMs, now),
  } : null;
}
export function memoryHealth(status: MemoryStatus | null, now: number) {
  if (!status) return null;
  const d = status.diagnostics;
  return { supported: status.supported, enabled: status.preferences.enabled, active: status.active,
    sources: status.sources, groups: status.groups, wikiPages: status.wikiPages, error: status.error, route: status.route,
    diagnostics: d ? { phase: d.phase, facts: d.facts, running: d.running, waiting: d.waiting, exhausted: d.exhausted,
      errors: d.errors, writes_hour: d.writes_hour, writes_day: d.writes_day, queries_hour: d.queries_hour,
      writes_hour_limit: d.writes_hour_limit, writes_day_limit: d.writes_day_limit, queries_hour_limit: d.queries_hour_limit,
      lastSourceAgeSeconds: age(d.last_source_at_ms, now), lastExtractedAgeSeconds: age(d.last_extracted_at_ms, now),
      nextAttemptInSeconds: d.next_attempt_at_ms === null ? null : Math.max(0, Math.round((d.next_attempt_at_ms - now) / 1000)),
    } : null };
}
function age(at: number | null, now: number): number | null {
  return at === null ? null : Math.max(0, Math.round((now - at) / 1000));
}

