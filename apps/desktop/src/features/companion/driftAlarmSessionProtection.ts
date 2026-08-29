import {
  areSameDriftAlarmSurface,
  resolveDriftAlarmSurface,
  type DriftAlarmSurface,
  type DriftAlarmSurfaceActivity,
} from "./driftAlarmSurface";

export const DRIFT_ALARM_SESSION_REENTRY_GRACE_MS = 5 * 60 * 1000;
export const DRIFT_ALARM_SESSION_EXIT_GRACE_MS = 2 * 60 * 1000;
export const DRIFT_ALARM_SESSION_HARD_CAP_MS = 60 * 60 * 1000;

type DriftAlarmSessionActivity = DriftAlarmSurfaceActivity;

export type DriftAlarmSessionProtection = {
  readonly surface: DriftAlarmSurface;
  readonly phase: "armed" | "active";
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly reentryDeadlineMs: number;
  readonly leftAtMs: number | null;
};

export type DriftAlarmSessionSuppressionReason =
  | "manual_session_protection"
  | "manual_session_protection_expiry_guard";

export function createDriftAlarmSessionProtection(
  activity: DriftAlarmSessionActivity,
  nowMs: number,
): DriftAlarmSessionProtection | null {
  const surface = resolveDriftAlarmSurface(activity);
  if (!surface || !Number.isFinite(nowMs)) return null;

  return {
    surface,
    phase: "armed",
    createdAtMs: nowMs,
    expiresAtMs: nowMs + DRIFT_ALARM_SESSION_HARD_CAP_MS,
    reentryDeadlineMs: nowMs + DRIFT_ALARM_SESSION_REENTRY_GRACE_MS,
    leftAtMs: null,
  };
}

export function armDriftAlarmSessionProtection(
  protection: DriftAlarmSessionProtection | null,
  activity: DriftAlarmSessionActivity,
  nowMs: number,
): DriftAlarmSessionProtection | null {
  // An unsafe new scope still receives its exact correction, but must not
  // cancel an unrelated protection the user already established.
  return createDriftAlarmSessionProtection(activity, nowMs) ?? protection;
}

export function advanceDriftAlarmSessionProtection(
  protection: DriftAlarmSessionProtection | null,
  currentActivity: DriftAlarmSessionActivity | null,
  nowMs: number,
): DriftAlarmSessionProtection | null {
  if (!protection || !Number.isFinite(nowMs) || nowMs >= protection.expiresAtMs) return null;

  const matches = currentActivity !== null && isDriftAlarmSessionProtected(protection, currentActivity);
  if (protection.phase === "armed") {
    if (nowMs >= protection.reentryDeadlineMs) return null;
    if (matches) {
      return { ...protection, phase: "active", leftAtMs: null };
    }
    return protection;
  }

  if (
    protection.leftAtMs !== null
    && nowMs - protection.leftAtMs >= DRIFT_ALARM_SESSION_EXIT_GRACE_MS
  ) return null;

  if (matches) {
    return protection.leftAtMs === null ? protection : { ...protection, leftAtMs: null };
  }
  // A missing tracker sample is not evidence that the user left the protected
  // surface, so only an observed different activity starts the exit grace.
  if (!currentActivity) return protection;

  const leftAtMs = protection.leftAtMs ?? nowMs;
  return protection.leftAtMs === leftAtMs ? protection : { ...protection, leftAtMs };
}

export function isDriftAlarmSessionProtected(
  protection: DriftAlarmSessionProtection | null,
  activity: DriftAlarmSessionActivity,
): boolean {
  if (!protection) return false;
  const surface = resolveDriftAlarmSurface(activity);
  return surface ? areSameDriftAlarmSurface(surface, protection.surface) : false;
}

export function driftAlarmSessionSuppressionReason(
  activeProtection: DriftAlarmSessionProtection | null,
  justExpiredProtection: DriftAlarmSessionProtection | null,
  activity: DriftAlarmSessionActivity,
): DriftAlarmSessionSuppressionReason | null {
  if (isDriftAlarmSessionProtected(activeProtection, activity)) {
    return "manual_session_protection";
  }
  if (isDriftAlarmSessionProtected(justExpiredProtection, activity)) {
    return "manual_session_protection_expiry_guard";
  }
  return null;
}
