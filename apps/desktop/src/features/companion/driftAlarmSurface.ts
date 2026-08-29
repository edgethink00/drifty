import { isBrowserActivity } from "@drifty/domain";
import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";

export type DriftAlarmSurfaceActivity = Pick<
  ActivitySegment | CurrentActivitySnapshot,
  "appName" | "bundleId" | "browserName" | "siteDomain" | "siteUrl"
>;

export type DriftAlarmSurface =
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

export function resolveDriftAlarmSurface(activity: DriftAlarmSurfaceActivity): DriftAlarmSurface | null {
  const bundleId = normalizedIdentity(activity.bundleId) || null;
  const browserNames = normalizedIdentities([activity.browserName, activity.appName]);
  const siteDomain = normalizedSiteDomain(activity.siteDomain)
    || normalizedSiteDomain(activity.siteUrl);
  if ((bundleId || browserNames.length > 0) && siteDomain) {
    return { kind: "browser", bundleId, browserNames, siteDomain };
  }

  // Missing browser context must never widen an episode or a manual
  // protection to the entire browser application.
  if (isBrowserActivity(activity)) return null;

  const appIdentity = bundleId || normalizedIdentity(activity.appName);
  return appIdentity ? { kind: "app", appIdentity } : null;
}

export function areSameDriftAlarmSurface(left: DriftAlarmSurface, right: DriftAlarmSurface): boolean {
  if (left.kind !== right.kind) return false;

  if (left.kind === "browser" && right.kind === "browser") {
    const sameBrowser = left.bundleId && right.bundleId
      ? left.bundleId === right.bundleId
      : left.browserNames.some((name) => right.browserNames.includes(name));
    return sameBrowser && left.siteDomain === right.siteDomain;
  }

  return left.kind === "app"
    && right.kind === "app"
    && left.appIdentity === right.appIdentity;
}

export function driftAlarmSurfaceKey(surface: DriftAlarmSurface): string {
  if (surface.kind === "browser") {
    return `browser:${surface.bundleId ?? surface.browserNames[0] ?? "unknown"}:${surface.siteDomain}`;
  }
  return `app:${surface.appIdentity}`;
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
