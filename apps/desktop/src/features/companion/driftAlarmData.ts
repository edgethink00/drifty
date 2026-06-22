import type { DriftAlarmEvent, DriftAlarmFocusTarget } from "./DriftAlarm";
import { isTauriRuntime } from "./watcherBridge";
import { classifyActivity, classifyActivityDetailed } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, ClassificationOptions, CurrentActivitySnapshot } from "@drifty/domain";
import { invoke } from "@tauri-apps/api/core";
import { getLatestWatcherSegment } from "./watcherData";
import { getActiveDriftAlarmSegment } from "./driftAlarmCurrentSegment";
import { EXTREME_NUDGE_STORAGE_KEY } from "./extremeNudgeData";
import { segmentForLiveDriftAlarmClassification } from "./liveDriftAlarmClassification";
export { EXTREME_NUDGE_STORAGE_KEY, buildExtremeNudgeTarget, buildExtremeNudgeToastEvent } from "./extremeNudgeData";

export type DriftAlarmBreakSnooze = {
  untilMs: number;
  minutes: number;
  pausedFromLabel: string;
  focusTargets: DriftAlarmFocusTarget[];
};

export type DriftAlertDelaySeconds = 0 | 30 | 60 | 120 | 300 | 600 | 900 | 1800;

export type DriftAlertDelayValue = "0" | "30" | "60" | "120" | "300" | "600" | "900" | "1800";

export const DRIFT_ALERTS_STORAGE_KEY = "drifty.notifications.driftAlerts";

export const DRIFT_ALERT_DELAY_STORAGE_KEY = "drifty.notifications.driftAlertDelaySeconds";

export const DEFAULT_DRIFT_ALERT_DELAY_SECONDS: DriftAlertDelaySeconds = 60;

export const DEFAULT_DRIFT_ALERT_DELAY_VALUE: DriftAlertDelayValue = "60";

export const DRIFT_ALERT_DELAY_OPTIONS = [
  { value: "0", seconds: 0, label: "Instant", detail: "As soon as drift is detected" },
  { value: "30", seconds: 30, label: "30s", detail: "After 30 seconds of drift" },
  { value: "60", seconds: 60, label: "1m", detail: "After 1 minute of drift" },
  { value: "120", seconds: 120, label: "2m", detail: "After 2 minutes of drift" },
  { value: "300", seconds: 300, label: "5m", detail: "After 5 minutes of drift" },
  { value: "600", seconds: 600, label: "10m", detail: "After 10 minutes of drift" },
  { value: "900", seconds: 900, label: "15m", detail: "After 15 minutes of drift" },
  { value: "1800", seconds: 1800, label: "30m", detail: "After 30 minutes of drift" },
] as const satisfies ReadonlyArray<{ value: DriftAlertDelayValue; seconds: DriftAlertDelaySeconds; label: string; detail: string }>;

export const DRIFT_ALARM_PREVIEW_OPTIONS = [
  { id: "youtube-5m", label: "YouTube 5m", contextLabel: "youtube.com", sourceSiteDomain: "youtube.com", sourceAppName: "Google Chrome", sourceIconSrc: null, driftDurationSeconds: 5 * 60, preservedFocusStrikeSeconds: 30 * 60 },
  { id: "x-12m", label: "X 12m", contextLabel: "x.com", sourceSiteDomain: "x.com", sourceAppName: "Google Chrome", sourceIconSrc: null, driftDurationSeconds: 12 * 60, preservedFocusStrikeSeconds: 60 * 60 },
  { id: "no-context-1h", label: "No context 1h", contextLabel: "", sourceSiteDomain: null, sourceAppName: "Some App", sourceIconSrc: null, driftDurationSeconds: 60 * 60, preservedFocusStrikeSeconds: 2 * 60 * 60 },
] as const;

export function buildFocusTargetFromSegment(segment: ActivitySegment, appIcons: AppIconMap): DriftAlarmFocusTarget {
  const appName = segment.appName.trim() || "Unknown app";
  const bundleId = segment.bundleId?.trim() || null;
  const browserName = segment.browserName?.trim() || null;
  const siteDomain = segment.siteDomain?.trim() || null;
  const siteTitle = segment.siteTitle?.trim() || null;
  const siteUrl = segment.siteUrl?.trim() || null;
  const windowTitle = segment.windowTitle?.trim() || null;
  const iconKey = bundleId ?? appName;
  const iconSrc = appIcons[iconKey] ?? appIcons[appName] ?? null;
  const label = siteDomain ?? siteTitle ?? appName;
  const detail = formatFocusTargetDetail({ appName, siteDomain, siteTitle, windowTitle });

  return {
    targetId: siteDomain ? `site:${siteDomain}` : `app:${bundleId ?? appName}`,
    label,
    detail,
    appName,
    bundleId,
    browserName,
    siteDomain,
    siteTitle,
    siteUrl,
    iconSrc,
  };
}

export function getFocusTargetIdentity(target: DriftAlarmFocusTarget): string {
  return (target.siteDomain ?? target.bundleId ?? target.appName).toLowerCase();
}

export function hasDriftAlarmFocusTargetUpdate(currentEvent: DriftAlarmEvent, nextEvent: DriftAlarmEvent): boolean {
  if (currentEvent.focusTargets.length !== nextEvent.focusTargets.length) return true;

  return nextEvent.focusTargets.some((nextTarget, index) => {
    const currentTarget = currentEvent.focusTargets[index];
    if (!currentTarget || currentTarget.targetId !== nextTarget.targetId) return true;
    if (!nextTarget.iconSrc) return false;
    return currentTarget?.iconSrc !== nextTarget.iconSrc;
  });
}

export type DriftAlarmCandidate = {
  alertKey: string;
  category: ActivityCategory;
  segment: ActivitySegment;
  sourceSegmentId: string | null;
};

const SHOPPING_DRIFT_ALARM_MINIMUM_SECONDS = 5 * 60;
const SHOPPING_DRIFT_ALARM_CONTEXT_WINDOW_MS = 5 * 60 * 1000;
const AI_DRIFT_ALARM_MINIMUM_CONFIDENCE = 0.85;

export function buildDriftAlarmCandidates({
  segments,
  currentSnapshot,
  classificationOptions,
  minimumDurationSeconds,
}: {
  segments: ActivitySegment[];
  currentSnapshot: CurrentActivitySnapshot | null;
  classificationOptions: ClassificationOptions;
  minimumDurationSeconds: number;
}): DriftAlarmCandidate[] {
  if (currentSnapshot) {
    const currentDriftAlarmSegment = getActiveDriftAlarmSegment(currentSnapshot, segments);
    if (!currentDriftAlarmSegment) return [];

    const { alertKey, segment: currentSegment, sourceSegmentId } = currentDriftAlarmSegment;
    const currentClassificationOptions = {
      ...classificationOptions,
      fallbackCandidates: [currentSegment, ...(classificationOptions.fallbackCandidates ?? segments)],
    } satisfies ClassificationOptions;
    const currentClassification = classifyActivityDetailed(segmentForLiveDriftAlarmClassification(currentSegment, segments), currentClassificationOptions);

    if (
      currentClassification.productivity === "drift"
      && classificationConfidenceAllowsDriftAlarm(currentClassification)
      && driftAlarmDurationMeetsThreshold({
        candidate: currentSegment,
        category: currentClassification.category,
        segments,
        classificationOptions: currentClassificationOptions,
        minimumDurationSeconds,
      })
    ) {
      return [{
        alertKey,
        category: currentClassification.category,
        segment: currentSegment,
        sourceSegmentId,
      }];
    }

    return [];
  }

  const latestSegment = getLatestWatcherSegment(segments);
  if (!latestSegment) return [];

  const latestClassification = classifyActivityDetailed(segmentForLiveDriftAlarmClassification(latestSegment, segments), classificationOptions);
  if (
    latestClassification.productivity !== "drift"
    || !classificationConfidenceAllowsDriftAlarm(latestClassification)
    || !driftAlarmDurationMeetsThreshold({
      candidate: latestSegment,
      category: latestClassification.category,
      segments,
      classificationOptions,
      minimumDurationSeconds,
    })
  ) return [];

  return [{
    alertKey: `${latestSegment.id}:${latestSegment.endedAt}`,
    category: latestClassification.category,
    segment: latestSegment,
    sourceSegmentId: latestSegment.id,
  }];
}

function classificationConfidenceAllowsDriftAlarm(classification: ReturnType<typeof classifyActivityDetailed>): boolean {
  if (classification.source !== "llm") return true;
  return classification.confidence >= AI_DRIFT_ALARM_MINIMUM_CONFIDENCE;
}

function driftAlarmDurationMeetsThreshold({
  candidate,
  category,
  segments,
  classificationOptions,
  minimumDurationSeconds,
}: {
  candidate: ActivitySegment;
  category: ActivityCategory;
  segments: ActivitySegment[];
  classificationOptions: ClassificationOptions;
  minimumDurationSeconds: number;
}): boolean {
  if (category !== "shopping") return candidate.durationSeconds >= minimumDurationSeconds;

  const shoppingMinimumSeconds = Math.max(minimumDurationSeconds, SHOPPING_DRIFT_ALARM_MINIMUM_SECONDS);
  if (candidate.durationSeconds >= shoppingMinimumSeconds) return true;

  return sumNearbyShoppingDriftSeconds(candidate, segments, classificationOptions) >= shoppingMinimumSeconds;
}

function sumNearbyShoppingDriftSeconds(candidate: ActivitySegment, segments: ActivitySegment[], classificationOptions: ClassificationOptions): number {
  const candidateStart = new Date(candidate.startedAt).getTime();
  const candidateEnd = new Date(candidate.endedAt).getTime();
  if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd) || candidateEnd <= candidateStart) return candidate.durationSeconds;

  const windowStart = candidateStart - SHOPPING_DRIFT_ALARM_CONTEXT_WINDOW_MS;
  const windowEnd = candidateEnd + SHOPPING_DRIFT_ALARM_CONTEXT_WINDOW_MS;

  return segments.reduce((total, segment) => {
    if (segment.id === candidate.id) return total;

    const segmentStart = new Date(segment.startedAt).getTime();
    const segmentEnd = new Date(segment.endedAt).getTime();
    if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) return total;
    if (segmentEnd <= windowStart || segmentStart >= windowEnd) return total;
    if (segmentStart < candidateEnd && segmentEnd > candidateStart) return total;

    const classification = classifyActivityDetailed(segmentForLiveDriftAlarmClassification(segment, segments), classificationOptions);
    if (classification.category !== "shopping" || classification.productivity !== "drift") return total;
    if (!classificationConfidenceAllowsDriftAlarm(classification)) return total;

    const overlapMs = Math.max(0, Math.min(segmentEnd, windowEnd) - Math.max(segmentStart, windowStart));
    return total + Math.round(overlapMs / 1000);
  }, candidate.durationSeconds);
}

export function buildRecentFocusTargets(segments: ActivitySegment[], historySegments: ActivitySegment[], classificationOptions: ClassificationOptions, appIcons: AppIconMap): DriftAlarmFocusTarget[] {
  const targets: DriftAlarmFocusTarget[] = [];
  const seen = new Set<string>();
  const sortedFocusSegments = segments
    .filter((segment) => classifyActivity(segment, classificationOptions).productivity === "focus")
    .sort((left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime());

  const addTarget = (target: DriftAlarmFocusTarget): boolean => {
    const dedupeKey = getFocusTargetIdentity(target);
    if (seen.has(dedupeKey)) return false;

    seen.add(dedupeKey);
    targets.push(target);
    return true;
  };

  const latestRecentFocusTarget = sortedFocusSegments[0] ? buildFocusTargetFromSegment(sortedFocusSegments[0], appIcons) : null;
  if (latestRecentFocusTarget) addTarget(latestRecentFocusTarget);

  const weeklyFocusStartMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weeklyClassificationOptions: ClassificationOptions = {
    ...classificationOptions,
    fallbackCandidates: historySegments,
  };
  const weeklyAppTargets = Array.from(historySegments.reduce((accumulator, segment) => {
    const endedAtMs = new Date(segment.endedAt).getTime();
    if (endedAtMs < weeklyFocusStartMs) return accumulator;
    if (classifyActivity(segment, weeklyClassificationOptions).productivity !== "focus") return accumulator;

    const appName = segment.appName.trim() || "Unknown app";
    const bundleId = segment.bundleId?.trim() || null;
    const identityKey = (bundleId ?? appName).toLowerCase();
    const current = accumulator.get(identityKey) ?? {
      appName,
      bundleId,
      windowTitle: segment.windowTitle?.trim() || null,
      totalSeconds: 0,
      latestEndedAtMs: endedAtMs,
    };

    current.totalSeconds += segment.durationSeconds;
    if (endedAtMs > current.latestEndedAtMs) {
      current.appName = appName;
      current.bundleId = bundleId;
      current.windowTitle = segment.windowTitle?.trim() || null;
      current.latestEndedAtMs = endedAtMs;
    }

    accumulator.set(identityKey, current);
    return accumulator;
  }, new Map<string, { appName: string; bundleId: string | null; windowTitle: string | null; totalSeconds: number; latestEndedAtMs: number }>()).values())
    .sort((left, right) => {
      const durationDelta = right.totalSeconds - left.totalSeconds;
      if (durationDelta !== 0) return durationDelta;
      return right.latestEndedAtMs - left.latestEndedAtMs;
    })
    .map((target) => {
      const iconKey = target.bundleId ?? target.appName;
      return {
        targetId: `app:${target.bundleId ?? target.appName}`,
        label: target.appName,
        detail: formatFocusTargetDetail({ appName: target.appName, siteDomain: null, siteTitle: null, windowTitle: target.windowTitle }),
        appName: target.appName,
        bundleId: target.bundleId,
        browserName: null,
        siteDomain: null,
        siteTitle: null,
        siteUrl: null,
        iconSrc: appIcons[iconKey] ?? appIcons[target.appName] ?? null,
      } satisfies DriftAlarmFocusTarget;
    });

  let weeklyTargetsAdded = 0;
  for (const target of weeklyAppTargets) {
    if (addTarget(target)) weeklyTargetsAdded += 1;
    if (weeklyTargetsAdded === 2) break;
  }

  for (const segment of sortedFocusSegments.slice(1)) {
    if (addTarget(buildFocusTargetFromSegment(segment, appIcons))) break;
  }

  return targets;
}

export function formatFocusTargetDetail({
  appName,
  siteDomain,
  siteTitle,
  windowTitle,
}: {
  appName: string;
  siteDomain: string | null;
  siteTitle: string | null;
  windowTitle: string | null;
}): string {
  if (siteDomain && siteTitle && siteTitle !== siteDomain) return `${siteTitle} · ${appName}`;
  if (siteDomain) return `Focus tab · ${appName}`;
  if (windowTitle && windowTitle !== appName) return windowTitle;
  return "Recent focus app";
}

export function resolveInitialDriftAlertsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DRIFT_ALERTS_STORAGE_KEY) === "1";
}

export function resolveInitialDriftAlertDelaySeconds(): DriftAlertDelaySeconds {
  if (typeof window === "undefined") return DEFAULT_DRIFT_ALERT_DELAY_SECONDS;
  return normalizeDriftAlertDelaySeconds(window.localStorage.getItem(DRIFT_ALERT_DELAY_STORAGE_KEY));
}

export function resolveInitialExtremeNudgeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(EXTREME_NUDGE_STORAGE_KEY) === "1";
}

export function normalizeDriftAlertDelaySeconds(value: string | number | null): DriftAlertDelaySeconds {
  if (value === null || value === "") return DEFAULT_DRIFT_ALERT_DELAY_SECONDS;
  const delayValue = typeof value === "number" ? String(value) : value;
  return DRIFT_ALERT_DELAY_OPTIONS.find((option) => option.value === delayValue)?.seconds ?? DEFAULT_DRIFT_ALERT_DELAY_SECONDS;
}

export function driftAlertDelayValueFromSeconds(seconds: DriftAlertDelaySeconds): DriftAlertDelayValue {
  return DRIFT_ALERT_DELAY_OPTIONS.find((option) => option.seconds === seconds)?.value ?? DEFAULT_DRIFT_ALERT_DELAY_VALUE;
}

export function driftAlertDelaySecondsFromValue(value: DriftAlertDelayValue): DriftAlertDelaySeconds {
  return DRIFT_ALERT_DELAY_OPTIONS.find((option) => option.value === value)?.seconds ?? DEFAULT_DRIFT_ALERT_DELAY_SECONDS;
}

export async function activateFocusTargetSite(target: DriftAlarmFocusTarget): Promise<boolean> {
  const siteDomain = target.siteDomain?.trim() ?? "";
  if (!siteDomain) return false;

  const browserName = target.browserName?.trim() ?? "";
  const siteUrl = target.siteUrl?.trim() || null;
  if (browserName && isTauriRuntime()) {
    try {
      const activated = await invoke<boolean>("focus_target_activate_browser_tab", { browserName, siteDomain, siteUrl });
      return activated === true;
    } catch (error) {
      console.warn("Failed to activate focus target browser tab", error);
      return false;
    }
  }

  return false;
}
