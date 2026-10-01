import type { DriftAlarmEvent, DriftAlarmFocusTarget } from "./driftAlarmEvent";
import { isTauriRuntime } from "./watcherBridge";
import { classifyActivity, classifyActivityDetailed, isSocialSite, isPurposefulSocialSurface, isUnresolvedSocialSurface, isYouTubeShortsSegment, SUSTAINED_SOCIAL_DWELL_MINIMUM_SEGMENTS, SUSTAINED_SOCIAL_DWELL_MINIMUM_SECONDS } from "@drifty/domain";
import type { ActivityCategory, ActivityClassificationDetail, ActivitySegment, AppIconMap, ClassificationOptions, CurrentActivitySnapshot } from "@drifty/domain";
import { invoke } from "@tauri-apps/api/core";
import { getLatestWatcherSegment } from "./watcherData";
import { getActiveDriftAlarmSegment } from "./driftAlarmCurrentSegment";
import { EXTREME_NUDGE_STORAGE_KEY } from "./extremeNudgeData";
import { segmentForLiveDriftAlarmClassification } from "./liveDriftAlarmClassification";
import { calibrateAppLlmClassificationWithHistory } from "./driftAlarmClassificationCalibration";
import { isBrowserHistoryContextPendingForDriftAlarm } from "./driftAlarmHistoryPending";
import { buildContinuousDriftAlarmEpisode, type DriftAlarmEpisode } from "./driftAlarmEpisode";
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

export const DEFAULT_DRIFT_ALERT_DELAY_SECONDS: DriftAlertDelaySeconds = 30;

export const DEFAULT_DRIFT_ALERT_DELAY_VALUE: DriftAlertDelayValue = "30";

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

export function buildFocusTargetFromSegment(
  segment: ActivitySegment,
  appIcons: AppIconMap,
  siteIcons: Readonly<Record<string, string | null>> = {},
): DriftAlarmFocusTarget {
  const appName = segment.appName.trim() || "Unknown app";
  const bundleId = segment.bundleId?.trim() || null;
  const browserName = segment.browserName?.trim() || null;
  const siteDomain = segment.siteDomain?.trim() || null;
  const siteTitle = segment.siteTitle?.trim() || null;
  const siteUrl = segment.siteUrl?.trim() || null;
  const windowTitle = segment.windowTitle?.trim() || null;
  const iconKey = bundleId ?? appName;
  // Site rows carry no bundle id, so their icon comes from the site cache;
  // it is resolved here because the alarm window cannot resolve it itself.
  const iconSrc = (siteDomain ? siteIcons[siteDomain.toLowerCase()] : null)
    ?? appIcons[iconKey]
    ?? appIcons[appName]
    ?? null;
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
  episodeKey: string;
  driftDurationSeconds: number;
  category: ActivityCategory;
  classification: ActivityClassificationDetail;
  segment: ActivitySegment;
  sourceSegmentId: string | null;
};

const SHOPPING_DRIFT_ALARM_MINIMUM_SECONDS = 5 * 60;
const SHOPPING_DRIFT_ALARM_CONTEXT_WINDOW_MS = 5 * 60 * 1000;
export const AI_DRIFT_ALARM_MINIMUM_CONFIDENCE = 0.85;

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

    const { segment: currentSegment, sourceSegmentId } = currentDriftAlarmSegment;
    if (isBrowserHistoryContextPendingForDriftAlarm(currentSnapshot, currentSegment)) return [];

    const currentClassificationOptions = {
      ...classificationOptions,
      fallbackCandidates: [currentSegment, ...(classificationOptions.fallbackCandidates ?? segments)],
    } satisfies ClassificationOptions;
    const currentClassification = classifyDriftAlarmSegmentWithHistory({
      segment: currentSegment,
      sourceSegmentId,
      segments,
      classificationOptions: currentClassificationOptions,
    });
    const currentEpisode = buildDriftAlarmEpisode({
      candidate: currentSegment,
      candidateClassification: currentClassification,
      segments,
      classificationOptions: currentClassificationOptions,
    });

    if (
      currentClassification.productivity === "drift"
      && classificationConfidenceAllowsDriftAlarm(currentClassification)
      && currentEpisode
      && driftAlarmDurationMeetsThreshold({
        candidate: currentSegment,
        driftDurationSeconds: currentEpisode.durationSeconds,
        category: currentClassification.category,
        segments,
        classificationOptions: currentClassificationOptions,
        minimumDurationSeconds,
      })
    ) {
      return [{
        alertKey: currentEpisode.episodeKey,
        episodeKey: currentEpisode.episodeKey,
        driftDurationSeconds: currentEpisode.durationSeconds,
        category: currentClassification.category,
        classification: currentClassification,
        segment: currentSegment,
        sourceSegmentId,
      }];
    }

    // Sustained social dwell: when the current segment is on a registered
    // social domain but could not be classified as drift (unknown/neutral,
    // typically because siteUrl was not captured or AI is unavailable),
    // check whether the user has been continuously dwelling on the same
    // social domain across multiple segments. Four or more consecutive
    // segments totalling at least 60 seconds is doomscrolling, not a
    // quick DM check.
    const sustainedSocialCandidate = buildSustainedSocialDwellCandidate({
      segment: currentSegment,
      sourceSegmentId,
      classification: currentClassification,
      segments,
      minimumDurationSeconds,
    });
    if (sustainedSocialCandidate) return [sustainedSocialCandidate];

    return [];
  }

  const latestSegment = getLatestWatcherSegment(segments);
  if (!latestSegment) return [];

  const latestClassification = classifyDriftAlarmSegmentWithHistory({
    segment: latestSegment,
    sourceSegmentId: latestSegment.id,
    segments,
    classificationOptions,
  });
  const latestEpisode = buildDriftAlarmEpisode({
    candidate: latestSegment,
    candidateClassification: latestClassification,
    segments,
    classificationOptions,
  });
  if (
    latestClassification.productivity !== "drift"
    || !classificationConfidenceAllowsDriftAlarm(latestClassification)
    || !latestEpisode
    || !driftAlarmDurationMeetsThreshold({
      candidate: latestSegment,
      driftDurationSeconds: latestEpisode.durationSeconds,
      category: latestClassification.category,
      segments,
      classificationOptions,
      minimumDurationSeconds,
    })
  ) {
    const sustainedSocialCandidate = buildSustainedSocialDwellCandidate({
      segment: latestSegment,
      sourceSegmentId: latestSegment.id,
      classification: latestClassification,
      segments,
      minimumDurationSeconds,
    });
    if (sustainedSocialCandidate) return [sustainedSocialCandidate];
    return [];
  }

  return [{
    alertKey: latestEpisode.episodeKey,
    episodeKey: latestEpisode.episodeKey,
    driftDurationSeconds: latestEpisode.durationSeconds,
    category: latestClassification.category,
    classification: latestClassification,
    segment: latestSegment,
    sourceSegmentId: latestSegment.id,
  }];
}

function classificationConfidenceAllowsDriftAlarm(classification: ReturnType<typeof classifyActivityDetailed>): boolean {
  if (classification.source !== "llm") return true;
  return classification.confidence >= AI_DRIFT_ALARM_MINIMUM_CONFIDENCE;
}

function classifyDriftAlarmSegmentWithHistory({
  segment,
  sourceSegmentId,
  segments,
  classificationOptions,
}: {
  segment: ActivitySegment;
  sourceSegmentId: string;
  segments: ActivitySegment[];
  classificationOptions: ClassificationOptions;
}): ReturnType<typeof classifyActivityDetailed> {
  const classification = classifyActivityDetailed(segmentForLiveDriftAlarmClassification(segment, segments), classificationOptions);
  return calibrateAppLlmClassificationWithHistory({
    segment,
    classification,
    historySegments: segments,
    classificationOptions,
    excludeSegmentIds: new Set([sourceSegmentId]),
  }).classification;
}

function buildDriftAlarmEpisode({
  candidate,
  candidateClassification,
  segments,
  classificationOptions,
}: {
  candidate: ActivitySegment;
  candidateClassification: ActivityClassificationDetail;
  segments: ActivitySegment[];
  classificationOptions: ClassificationOptions;
}): DriftAlarmEpisode | null {
  return buildContinuousDriftAlarmEpisode({
    currentSegment: candidate,
    segments,
    isEligibleDrift: (segment) => {
      const classification = segment.id === candidate.id
        ? candidateClassification
        : classifyDriftAlarmSegmentWithHistory({
          segment,
          sourceSegmentId: segment.id,
          segments,
          classificationOptions,
        });
      return classification.productivity === "drift"
        && classificationConfidenceAllowsDriftAlarm(classification);
    },
  });
}

function driftAlarmDurationMeetsThreshold({
  candidate,
  driftDurationSeconds,
  category,
  segments,
  classificationOptions,
  minimumDurationSeconds,
}: {
  candidate: ActivitySegment;
  driftDurationSeconds: number;
  category: ActivityCategory;
  segments: ActivitySegment[];
  classificationOptions: ClassificationOptions;
  minimumDurationSeconds: number;
}): boolean {
  if (category !== "shopping") return driftDurationSeconds >= minimumDurationSeconds;

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

/**
 * Detects sustained short-form-video dwell that warrants a drift alarm even
 * without AI classification. When a user scrolls through 4+ consecutive
 * segments on the same social domain (or YouTube Shorts) totalling ≥ 60
 * seconds, that behavioural signal alone is strong enough to classify the
 * episode as drift — no URL-path evidence or AI verdict required.
 *
 * Purposeful segments (DMs, notifications, settings) break the chain.
 * Non-Shorts YouTube segments (tutorials, music) also break the chain.
 */
function buildSustainedSocialDwellCandidate(input: {
  readonly segment: ActivitySegment;
  readonly sourceSegmentId: string | null;
  readonly classification: ActivityClassificationDetail;
  readonly segments: readonly ActivitySegment[];
  readonly minimumDurationSeconds: number;
}): DriftAlarmCandidate | null {
  // Only triggers when normal classification could not resolve the segment
  // as drift — i.e. it came back unknown/neutral, typically because the
  // siteUrl was not captured or AI is unavailable.
  if (input.classification.productivity === "drift") return null;
  // Respect explicit user decisions: a manual correction or a classification
  // rule means the user said this surface is not drift. The hard rule must
  // not override that intent.
  const src = input.classification.source;
  if (src === "manual" || src === "rule") return null;

  const isSocial = isSocialSite(input.segment.siteDomain) && !isPurposefulSocialSurface(input.segment);
  const isShorts = isYouTubeShortsSegment(input.segment);
  if (!isSocial && !isShorts) return null;

  const episode = buildContinuousDriftAlarmEpisode({
    currentSegment: input.segment as ActivitySegment,
    segments: input.segments as ActivitySegment[],
    isEligibleDrift: (segment) => {
      // Social site segments (Instagram, TikTok, X, Facebook) are eligible
      // unless they're on a purposeful surface (DM, notifications, settings).
      if (isSocialSite(segment.siteDomain) && !isPurposefulSocialSurface(segment)) return true;
      // YouTube Shorts segments are eligible — rapid short-form video
      // consumption is the same doomscroll pattern.
      if (isYouTubeShortsSegment(segment)) return true;
      return false;
    },
  });

  if (!episode) return null;
  if (episode.segmentIds.length < SUSTAINED_SOCIAL_DWELL_MINIMUM_SEGMENTS) return null;
  if (episode.durationSeconds < SUSTAINED_SOCIAL_DWELL_MINIMUM_SECONDS) return null;

  // Apply the user's configured delay threshold as well — the sustained
  // dwell must also meet the general minimum-duration-seconds setting.
  if (episode.durationSeconds < input.minimumDurationSeconds) return null;

  const category = isShorts && !isSocial ? "entertainment" as ActivityCategory : "social_media" as ActivityCategory;
  const surfaceLabel = input.segment.siteDomain ?? "social site";

  return {
    alertKey: episode.episodeKey,
    episodeKey: episode.episodeKey,
    driftDurationSeconds: episode.durationSeconds,
    category,
    classification: {
      ...input.classification,
      category,
      productivity: "drift" as const,
      source: "sustained-social-dwell" as const,
      confidence: 1,
      reason: `Sustained social dwell: ${episode.segmentIds.length} segments, ${Math.round(episode.durationSeconds)}s on ${surfaceLabel}`,
    },
    segment: input.segment,
    sourceSegmentId: input.sourceSegmentId,
  };
}

export function buildRecentFocusTargets(segments: ActivitySegment[], historySegments: ActivitySegment[], classificationOptions: ClassificationOptions, appIcons: AppIconMap, siteIcons: Readonly<Record<string, string | null>> = {}): DriftAlarmFocusTarget[] {
  const targets: DriftAlarmFocusTarget[] = [];
  const seen = new Set<string>();
  const sortedFocusSegments = segments
    .filter((segment) => classifyActivity(segment, classificationOptions).productivity === "focus")
    .sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt));

  const addTarget = (target: DriftAlarmFocusTarget): boolean => {
    const dedupeKey = getFocusTargetIdentity(target);
    if (seen.has(dedupeKey)) return false;

    seen.add(dedupeKey);
    targets.push(target);
    return true;
  };

  const latestRecentFocusTarget = sortedFocusSegments[0]
    ? buildFocusTargetFromSegment(sortedFocusSegments[0], appIcons, siteIcons)
    : null;
  if (latestRecentFocusTarget) addTarget(latestRecentFocusTarget);

  const weeklyFocusStartMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weeklyClassificationOptions: ClassificationOptions = {
    ...classificationOptions,
    fallbackCandidates: historySegments,
  };
  const weeklyAppTargets = Array.from(historySegments.reduce((accumulator, segment) => {
    const endedAtMs = Date.parse(segment.endedAt);
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
    if (addTarget(buildFocusTargetFromSegment(segment, appIcons, siteIcons))) break;
  }

  return targets;
}

export function canApplyExtremeNudgeToCategory(category: ActivityCategory): boolean {
  return category !== "communication";
}

/**
 * Closing a tab or quitting an app cannot be undone, so it needs stronger
 * evidence than showing a card does. A social surface only reaches this point
 * when its URL path could not settle the question on its own, so the live AI
 * verdict is the only thing standing between a work DM and a destroyed tab:
 * without it, the alarm still shows, but nothing gets closed.
 */
export function canApplyExtremeNudgeToSurface(input: {
  readonly segment: ActivitySegment;
  readonly category: ActivityCategory;
  readonly aiConfirmedDrift: boolean;
  readonly classificationSource?: ActivityClassificationDetail["source"] | null;
}): boolean {
  if (!canApplyExtremeNudgeToCategory(input.category)) return false;
  if (!isUnresolvedSocialSurface(input.segment)) return true;
  // A user rule, a manual correction, or a stored AI verdict already answered
  // this exact question. Demanding a fresh confirmation would override the
  // user's own instruction and quietly stop closing what they asked to close.
  if (input.classificationSource && RESOLVED_DRIFT_SOURCES.has(input.classificationSource)) return true;
  return input.aiConfirmedDrift;
}

const RESOLVED_DRIFT_SOURCES: ReadonlySet<ActivityClassificationDetail["source"]> = new Set([
  "manual",
  "rule",
  "llm",
  "sustained-social-dwell",
]);

/**
 * Drift verdicts that never need a live AI confirmation before delivery,
 * whether or not AI is currently available. A user rule or manual correction
 * is the user's own instruction; the sustained social dwell hard rule was
 * decided precisely so that doomscrolling is caught without AI
 * (docs/product-decisions.md, 2026-09-12). A stored `llm` verdict is not
 * exempt: the live gate exists to revalidate AI verdicts on these surfaces.
 * Lives here rather than in the gate module so App.tsx can consult it even
 * where tests mock the gate.
 */
export const DRIFT_ALARM_GATE_EXEMPT_SOURCES: ReadonlySet<ActivityClassificationDetail["source"]> = new Set([
  "manual",
  "rule",
  "sustained-social-dwell",
]);

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
