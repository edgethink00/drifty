import type { ScreenContextStatus } from "@drifty/domain";
import type { MemoryStatus } from "../screen-context/memoryWire";
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

