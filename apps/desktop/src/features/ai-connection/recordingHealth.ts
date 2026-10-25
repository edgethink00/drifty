import type { TrackerStatus } from "@drifty/domain";
import { isTrackerStorageLow } from "../../lib/trackerStorage";

export const RECORDING_STATUS_MAX_AGE_MS = 90_000;
export type RecordingHealthKind = "recording" | "idle" | "suppressed" | "paused" | "pausing" | "permission" | "degraded" | "storage" | "unknown" | "preview";
export type RecordingRecoveryAction = "resume" | "pause" | "settings" | "check";
export type RecordingHealth = {
  readonly kind: RecordingHealthKind;
  readonly action: RecordingRecoveryAction | null;
};

export function resolveRecordingHealth(input: {
  readonly native: boolean;
  readonly preview: boolean;
  readonly status: TrackerStatus | null;
  readonly statusFresh: boolean;
  readonly captureFresh: boolean;
  readonly pausePending: boolean;
  readonly accessibilityRequired: boolean;
  readonly captureGap: boolean;
  readonly now: number;
}): RecordingHealth {
  const { status } = input;
  if (!input.native || input.preview || status?.trackerMode === "demo" || status?.trackerMode === "preview"
    || status?.databasePath === "/tmp/drifty-demo.sqlite3") return { kind: "preview", action: null };
  if (input.pausePending) return { kind: "pausing", action: null };
  if (!status || status.trackerMode === "unavailable" || !input.statusFresh || !input.captureFresh) {
    return { kind: "unknown", action: "check" };
  }
  // A failed stop can leave the process alive with pause intent persisted.
  if (status.trackerMode === "degraded" || (status.running === true && status.trackingPaused === true)) {
    return { kind: "degraded", action: status.running === true ? "pause" : "resume" };
  }
  if (status.running === false && status.trackingPaused === true) return { kind: "paused", action: "resume" };
  if (input.accessibilityRequired && status.accessibilityGranted === false) return { kind: "permission", action: "settings" };
  if (status.running === false) return { kind: "paused", action: "resume" };
  if (status.running !== true) return { kind: "unknown", action: "check" };
  // A full volume stops capture writes while status reads keep working, so the
  // last event only ages into "unconfirmed". Name the cause instead.
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
