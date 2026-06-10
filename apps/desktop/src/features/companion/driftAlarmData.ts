import type { DriftAlarmEvent, DriftAlarmFocusTarget } from "./DriftAlarm";
import type { ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import type { ExtremeNudgeTarget } from "./driftAlarmBridge";
import { isTauriRuntime } from "./watcherBridge";
import { classifyActivity, isYouTubeBrowsePage } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, ClassificationOptions, CurrentActivitySnapshot } from "@drifty/domain";
import { invoke } from "@tauri-apps/api/core";
import { activitySegmentIdentity, currentSnapshotIdentity, currentSnapshotToSegment, getLatestWatcherSegment } from "./watcherData";

export type DriftAlarmBreakSnooze = {
  untilMs: number;
  minutes: number;
  pausedFromLabel: string;
  focusTargets: DriftAlarmFocusTarget[];
};

export type DriftAlertDelaySeconds = 0 | 60 | 300;

export const DRIFT_ALERTS_STORAGE_KEY = "drifty.notifications.driftAlerts";

export const DRIFT_ALERT_DELAY_STORAGE_KEY = "drifty.notifications.driftAlertDelaySeconds";

export const EXTREME_NUDGE_STORAGE_KEY = "drifty.notifications.extremeNudge";

export const DRIFT_ALERT_DELAY_OPTIONS = [
  { value: 0, label: "Instant", detail: "As soon as drift is detected" },
  { value: 60, label: "1m", detail: "After 1 minute of drift" },
  { value: 300, label: "5m", detail: "After 5 minutes of drift" },
] as const satisfies ReadonlyArray<{ value: DriftAlertDelaySeconds; label: string; detail: string }>;

export const DRIFT_ALARM_PREVIEW_OPTIONS = [
  { id: "youtube-5m", label: "YouTube 5m", contextLabel: "youtube.com", driftDurationSeconds: 5 * 60, preservedFocusStrikeSeconds: 30 * 60 },
  { id: "x-12m", label: "X 12m", contextLabel: "x.com", driftDurationSeconds: 12 * 60, preservedFocusStrikeSeconds: 60 * 60 },
  { id: "no-context-1h", label: "No context 1h", contextLabel: "", driftDurationSeconds: 60 * 60, preservedFocusStrikeSeconds: 2 * 60 * 60 },
] as const;

export function buildExtremeNudgeTarget(segment: ActivitySegment): ExtremeNudgeTarget {
  return {
    appName: segment.appName.trim() || "Unknown app",
    bundleId: segment.bundleId?.trim() || null,
    browserName: segment.browserName?.trim() || null,
    siteDomain: segment.siteDomain?.trim() || null,
    siteUrl: segment.siteUrl?.trim() || null,
  };
}

export function buildExtremeNudgeToastEvent(segment: ActivitySegment, focusTarget: DriftAlarmFocusTarget | null): ExtremeNudgeToastEvent {
  const closedLabel = segment.siteDomain?.trim()
    || segment.siteTitle?.trim()
    || segment.appName.trim()
    || "drift";

  return {
    kind: "extremeNudgeToast",
    placement: "top-right",
    id: `extreme-nudge:${segment.id}:${Date.now()}`,
    generatedAt: new Date().toISOString(),
    closedLabel,
    focusLabel: focusTarget?.label ?? null,
  };
}

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

export function hasDriftAlarmFocusTargetIconUpgrade(currentEvent: DriftAlarmEvent, nextEvent: DriftAlarmEvent): boolean {
  const currentTargetsById = new Map(currentEvent.focusTargets.map((target) => [target.targetId, target]));
  return nextEvent.focusTargets.some((nextTarget) => {
    if (!nextTarget.iconSrc) return false;
    const currentTarget = currentTargetsById.get(nextTarget.targetId);
    return currentTarget?.iconSrc !== nextTarget.iconSrc;
  });
}

export type DriftAlarmCandidate = {
  alertKey: string;
  category: ActivityCategory;
  segment: ActivitySegment;
};

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
    if (!isCurrentSnapshotFreshEnoughForDriftAlarm(currentSnapshot, segments)) return [];

    const durationSeconds = getCurrentSnapshotAlarmDurationSeconds(currentSnapshot, segments);
    const currentSegment = currentSnapshotToSegment(currentSnapshot, durationSeconds);
    const currentClassificationOptions = {
      ...classificationOptions,
      fallbackCandidates: [currentSegment, ...(classificationOptions.fallbackCandidates ?? segments)],
    } satisfies ClassificationOptions;
    const currentClassification = classifyActivity(segmentForLiveDriftAlarmClassification(currentSegment), currentClassificationOptions);

    if (currentClassification.productivity === "drift" && currentSegment.durationSeconds >= minimumDurationSeconds) {
      return [{
        alertKey: `current:${currentSnapshotIdentity(currentSnapshot)}`,
        category: currentClassification.category,
        segment: currentSegment,
      }];
    }

    return [];
  }

  const latestSegment = getLatestWatcherSegment(segments);
  if (!latestSegment) return [];

  const latestClassification = classifyActivity(segmentForLiveDriftAlarmClassification(latestSegment), classificationOptions);
  if (latestClassification.productivity !== "drift" || latestSegment.durationSeconds < minimumDurationSeconds) return [];

  return [{
    alertKey: `${latestSegment.id}:${latestSegment.endedAt}`,
    category: latestClassification.category,
    segment: latestSegment,
  }];
}

export function segmentForLiveDriftAlarmClassification(segment: ActivitySegment): ActivitySegment {
  if (!isYouTubeBrowsePage(segment)) return segment;
  return { ...segment, classification: null };
}

export function isCurrentSnapshotFreshEnoughForDriftAlarm(current: CurrentActivitySnapshot, segments: ActivitySegment[]): boolean {
  const latestSegment = getLatestWatcherSegment(segments);
  if (!latestSegment) return true;
  if (activitySegmentIdentity(latestSegment) === currentSnapshotIdentity(current)) return true;

  const observedAt = new Date(current.observedAt).getTime();
  const latestEndedAt = new Date(latestSegment.endedAt).getTime();
  if (!Number.isFinite(observedAt) || !Number.isFinite(latestEndedAt)) return false;

  return observedAt >= latestEndedAt;
}

export function getCurrentSnapshotAlarmDurationSeconds(current: CurrentActivitySnapshot, segments: ActivitySegment[]): number {
  const latestSegment = getLatestWatcherSegment(segments);
  if (!latestSegment) return 0;
  if (activitySegmentIdentity(latestSegment) !== currentSnapshotIdentity(current)) return 0;

  const observedAt = new Date(current.observedAt).getTime();
  const endedAt = new Date(latestSegment.endedAt).getTime();
  const elapsedSeconds = Number.isFinite(observedAt) && Number.isFinite(endedAt) ? Math.max(0, Math.round((observedAt - endedAt) / 1000)) : 0;
  return latestSegment.durationSeconds + elapsedSeconds;
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
  if (typeof window === "undefined") return 0;
  return normalizeDriftAlertDelaySeconds(window.localStorage.getItem(DRIFT_ALERT_DELAY_STORAGE_KEY));
}

export function resolveInitialExtremeNudgeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(EXTREME_NUDGE_STORAGE_KEY) === "1";
}

export function normalizeDriftAlertDelaySeconds(value: string | number | null): DriftAlertDelaySeconds {
  const numericValue = typeof value === "number" ? value : Number(value);
  return DRIFT_ALERT_DELAY_OPTIONS.some((option) => option.value === numericValue) ? numericValue as DriftAlertDelaySeconds : 0;
}

export async function openFocusTargetSite(siteDomain: string): Promise<void> {
  const domain = siteDomain.trim();
  if (!domain) return;
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(`https://${domain}`);
}

export async function activateFocusTargetSite(target: DriftAlarmFocusTarget): Promise<void> {
  const siteDomain = target.siteDomain?.trim() ?? "";
  if (!siteDomain) return;

  const browserName = target.browserName?.trim() ?? "";
  const siteUrl = target.siteUrl?.trim() ?? "";
  if (browserName && siteUrl && isTauriRuntime()) {
    try {
      const activated = await invoke<boolean>("focus_target_activate_browser_tab", { browserName, siteUrl });
      if (activated) return;
    } catch (error) {
      console.warn("Failed to activate focus target browser tab", error);
    }
  }

  await openFocusTargetSite(siteDomain);
}
