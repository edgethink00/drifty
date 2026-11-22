import type { TrackerStatus } from "@drifty/domain";
import { isTrackerStorageFull, isTrackerStorageLow } from "../../lib/trackerStorage";

export const RECORDING_STATUS_MAX_AGE_MS = 90_000;
export type RecordingHealthKind = "recording" | "idle" | "suppressed" | "paused" | "pausing" | "permission" | "degraded" | "storage" | "storageFull" | "databaseUnavailable" | "unknown" | "preview";
export type RecordingRecoveryAction = "resume" | "retry" | "pause" | "settings" | "check";
export type RecordingHealth = {
  readonly kind: RecordingHealthKind;
  readonly action: RecordingRecoveryAction | null;
};

export type TrackerRunState = Pick<TrackerStatus, "running" | "trackingPaused" | "trackerMode" | "captureHealth" | "captureFailureReason">;

export function isUnpausedTrackerStop(status: TrackerRunState | null): boolean {
  return status?.running === false && status.trackingPaused === false
    && (status.trackerMode === "idle" || status.trackerMode === "stopped");
}

export function resolveRecordingHealth(input: {
  readonly native: boolean;
  readonly preview: boolean;
  readonly status: TrackerStatus | null;
  readonly statusFresh: boolean;
  readonly storageFresh?: boolean;
  readonly captureFresh: boolean;
  readonly captureRunState?: TrackerRunState | null;
  readonly pausePending: boolean;
  readonly accessibilityRequired: boolean;
  readonly captureGap: boolean;
  readonly now: number;
}): RecordingHealth {
  const { status } = input;
  if (!input.native || input.preview || status?.trackerMode === "demo" || status?.trackerMode === "preview"
    || status?.databasePath === "/tmp/drifty-demo.sqlite3") return { kind: "preview", action: null };
  if (input.pausePending) return { kind: "pausing", action: null };
  // The volume measurement is independent of a capture read that may itself fail.
  if ((input.storageFresh ?? input.statusFresh) && isTrackerStorageFull(status)) return { kind: "storageFull", action: null };
  if (status?.statusIssue === "databaseUnavailable") return { kind: "databaseUnavailable", action: "check" };
  if (!status || status.trackerMode === "unavailable" || !input.captureFresh) {
    return { kind: "unknown", action: "check" };
  }
  if (!input.statusFresh) {
    // A live tail can confirm a stop without renewing permission or recording
    // evidence from the full status.
    const observed = input.captureRunState ?? null;
    if (observed?.trackingPaused === true) return { kind: "paused", action: "resume" };
    if (isUnpausedTrackerStop(observed)) return { kind: "degraded", action: "retry" };
    return { kind: "unknown", action: "check" };
  }
  // A saved pause is paused even while the process exits or its status is
  // unreadable: the tracker checks the pause before every save.
  if (status.trackingPaused === true) return { kind: "paused", action: "resume" };
  if (status.trackerMode === "degraded") {
    return { kind: "degraded", action: status.running === true ? "pause" : "resume" };
  }
  if (input.accessibilityRequired && status.accessibilityGranted === false) return { kind: "permission", action: "settings" };
  if (isUnpausedTrackerStop(status)) return { kind: "degraded", action: "retry" };
  if (status.running === false) return { kind: "paused", action: "resume" };
  if (status.running !== true) return { kind: "unknown", action: "check" };
  const captureHealth = input.captureRunState?.captureHealth ?? status.captureHealth;
  if (captureHealth && !["recording", "idle", "suppressed"].includes(captureHealth)) {
    return { kind: "unknown", action: "check" };
  }
  // Warn before writes fail, even if the last capture is stale.
  if (isTrackerStorageLow(status)) return { kind: "storage", action: null };
  if (status.trackerMode === "idle") return { kind: "idle", action: null };
  if (status.trackerMode === "suppressed") return { kind: "suppressed", action: null };
  const lastEventAt = status.lastEventAt ? Date.parse(status.lastEventAt) : NaN;
  if (status.trackerMode !== "tracking" || input.captureGap || !Number.isFinite(lastEventAt)
    || lastEventAt > input.now || input.now - lastEventAt >= RECORDING_STATUS_MAX_AGE_MS) {
    return { kind: "unknown", action: "check" };
  }
  return { kind: "recording", action: null };
}
