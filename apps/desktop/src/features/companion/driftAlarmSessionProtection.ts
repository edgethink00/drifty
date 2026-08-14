import { isBrowserActivity, type ActivitySegment, type CurrentActivitySnapshot } from "@drifty/domain";

export const DRIFT_ALARM_SESSION_REENTRY_GRACE_MS = 5 * 60 * 1000;
export const DRIFT_ALARM_SESSION_EXIT_GRACE_MS = 2 * 60 * 1000;
export const DRIFT_ALARM_SESSION_HARD_CAP_MS = 60 * 60 * 1000;

type DriftAlarmSessionActivity = Pick<
  ActivitySegment | CurrentActivitySnapshot,
  "appName" | "bundleId" | "browserName" | "siteDomain" | "siteUrl"
>;

type DriftAlarmSessionSurface =
  | {
      readonly kind: "browser";
      readonly bundleId: string | null;
      readonly browserNames: readonly string[];
      readonly siteDomain: string;
    }
  | {
      readonly kind: "app";
      readonly appIdentity: string;
    };

export type DriftAlarmSessionProtection = {
  readonly surface: DriftAlarmSessionSurface;
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
  const surface = driftAlarmSessionSurface(activity);
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
  const surface = driftAlarmSessionSurface(activity);
  if (!surface || surface.kind !== protection.surface.kind) return false;

  if (surface.kind === "browser" && protection.surface.kind === "browser") {
    const protectedBrowser = protection.surface;
    const sameBrowser = surface.bundleId && protectedBrowser.bundleId
      ? surface.bundleId === protectedBrowser.bundleId
      : surface.browserNames.some((name) => protectedBrowser.browserNames.includes(name));
    return sameBrowser && surface.siteDomain === protection.surface.siteDomain;
  }

  return surface.kind === "app"
    && protection.surface.kind === "app"
    && surface.appIdentity === protection.surface.appIdentity;
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

function driftAlarmSessionSurface(activity: DriftAlarmSessionActivity): DriftAlarmSessionSurface | null {
  const bundleId = normalizedIdentity(activity.bundleId) || null;
  const browserNames = normalizedIdentities([
    activity.browserName,
    activity.appName,
  ]);
  // Match the exact normalized host (apart from a leading www). A malformed
  // captured domain must not hide a valid host available in the URL.
  const siteDomain = normalizedSiteDomain(activity.siteDomain)
    || normalizedSiteDomain(activity.siteUrl);
  if ((bundleId || browserNames.length > 0) && siteDomain) {
    return { kind: "browser", bundleId, browserNames, siteDomain };
  }

  // A browser without captured site context must not turn a correction into a
  // browser-wide bypass. It can still receive the existing exact-item durable
  // correction, but there is no reliable surface for temporary protection.
  if (isBrowserActivity(activity)) return null;

  const appIdentity = bundleId || normalizedIdentity(activity.appName);
  return appIdentity ? { kind: "app", appIdentity } : null;
}

function normalizedIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizedIdentities(values: readonly (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.map(normalizedIdentity).filter(Boolean)));
}

function normalizedSiteDomain(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}
