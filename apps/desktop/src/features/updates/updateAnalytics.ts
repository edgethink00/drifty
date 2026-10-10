import {
  capturePostHogDailyEvent,
  toAnalyticsErrorKind,
  toDailyDedupKey,
  type PostHogEventPropertiesByName,
} from "../../lib/analytics/posthogClient";
import type { UPDATE_SOURCES, UPDATE_STEPS } from "../../lib/analytics/eventTaxonomy";
import { BUILD_INFO } from "../../buildInfo";
import { compareReleaseVersions } from "./updatePolicy";

/** The version this install ran last, used only to notice a completed update. */
export const UPDATE_LAST_RUN_VERSION_STORAGE_KEY = "drifty.updates.lastRunVersion.v1";

export type UpdateAnalyticsStep = (typeof UPDATE_STEPS)[number];
export type UpdateAnalyticsSource = (typeof UPDATE_SOURCES)[number];

type UpdateStepDetails = {
  readonly source?: UpdateAnalyticsSource;
  readonly backgroundUpdatesEnabled?: boolean;
  readonly backgroundEligible?: boolean;
  readonly error?: unknown;
};

type VersionStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Reports one step of the update path. Update checks repeat on a timer, so
 * every step goes through the daily cap: one event per step and property
 * combination per reporting day. No version strings or error text leave the
 * device; the event's default app_version identifies the running build.
 */
export function reportUpdateStep(step: UpdateAnalyticsStep, details: UpdateStepDetails = {}): void {
  const properties: PostHogEventPropertiesByName["app_update"] = {
    update_step: step,
    ...(details.source ? { update_source: details.source } : {}),
    ...(details.backgroundUpdatesEnabled === undefined ? {} : { background_updates_enabled: details.backgroundUpdatesEnabled }),
    ...(details.backgroundEligible === undefined ? {} : { background_eligible: details.backgroundEligible }),
    ...(details.error === undefined ? {} : { error_kind: toAnalyticsErrorKind(details.error) }),
  };
  capturePostHogDailyEvent("app_update", toDailyDedupKey(properties), properties);
}

function readVersionStorage(): VersionStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reports "applied" once when this launch runs a newer version than the last
 * launch. A first launch only records the version.
 */
export function reportUpdateAppliedSinceLastRun(
  storage: VersionStorage | null = readVersionStorage(),
  runningVersion: string = BUILD_INFO.version,
): boolean {
  if (!storage) return false;
  let previousVersion: string | null;
  try {
    previousVersion = storage.getItem(UPDATE_LAST_RUN_VERSION_STORAGE_KEY);
    if (previousVersion !== runningVersion) storage.setItem(UPDATE_LAST_RUN_VERSION_STORAGE_KEY, runningVersion);
  } catch {
    // Measurement must never affect the update path.
    return false;
  }
  if (!previousVersion || compareReleaseVersions(runningVersion, previousVersion) <= 0) return false;
  reportUpdateStep("applied");
  return true;
}
