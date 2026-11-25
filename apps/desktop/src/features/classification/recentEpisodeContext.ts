import {
  isExcludedSegment,
  type ActivitySegment,
  type RecentEpisodePromptContext,
  type RecentEpisodePromptTransition,
} from "@drifty/domain";
import { normalizeClassificationTitles } from "@drifty/domain";

import type { AiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";

export const RECENT_EPISODE_WINDOW_MINUTES = 30;
const MAX_EPISODE_TRANSITIONS = 8;
const MAX_CONTINUITY_GAP_MS = 5 * 60 * 1000;
const MAX_TITLE_LENGTH = 120;

type MutableTransition = {
  appName: string;
  domain?: string;
  title?: string;
  durationSeconds: number;
  surfaceKey: string;
};

export function buildRecentEpisodeContext(input: {
  readonly current: ActivitySegment;
  readonly segments: readonly ActivitySegment[];
  readonly privacySettings: AiPrivacyRequestSettings;
}): RecentEpisodePromptContext {
  const capturedEndMs = timestampMs(input.current.endedAt);
  const currentEndMs = capturedEndMs ?? Date.now();
  // A first tracker sample has coincident timestamps but still credits time.
  // Reserve its recorded seconds in the window while stopping history at the sample timestamp.
  const pointSeconds = capturedEndMs !== null
    && timestampMs(input.current.startedAt) === capturedEndMs
    && !isExcludedSegment(input.current)
    ? boundedDurationSeconds(input.current)
    : 0;
  const windowStartMs = currentEndMs + pointSeconds * 1_000 - RECENT_EPISODE_WINDOW_MINUTES * 60 * 1000;
  const localDeviceId = input.current.deviceId?.trim() || null;
  // Excluded apps and sites keep only their local time. In the provider's
  // context that span is unobserved, never a "[Redacted]" transition whose
  // position and length would describe the excluded activity.
  const history = input.segments.filter((segment) => !isExcludedSegment(segment));
  const candidates = uniqueSegments([...history, input.current])
    .filter((segment) => {
      if (pointSeconds > 0 && segment.id === input.current.id) return false;
      const startMs = timestampMs(segment.startedAt);
      const endMs = timestampMs(segment.endedAt);
      if (startMs === null || endMs === null) return false;
      const segmentDeviceId = segment.deviceId?.trim() || null;
      return endMs > windowStartMs
        && startMs < currentEndMs
        && segmentDeviceId === localDeviceId;
    })
    .sort((a, b) => (timestampMs(a.startedAt) ?? 0) - (timestampMs(b.startedAt) ?? 0));

  const continuous = continuousSuffix(candidates, currentEndMs);
  if (pointSeconds > 0) continuous.push(input.current);
  const durationFor = (segment: ActivitySegment) => segment === input.current && pointSeconds > 0
    ? pointSeconds
    : observedDurationSeconds(segment, windowStartMs, currentEndMs);
  const transitions = compressTransitions(continuous, input.privacySettings, durationFor).slice(-MAX_EPISODE_TRANSITIONS);
  const observedSeconds = continuous.reduce(
    (total, segment) => total + durationFor(segment),
    0,
  );
  const dominantSurface = dominantSurfaceLabel(continuous, durationFor);
  const currentSurfaceSeconds = currentSurfaceDurationSeconds(continuous, durationFor);

  return {
    windowMinutes: RECENT_EPISODE_WINDOW_MINUTES,
    observedMinutes: Math.min(RECENT_EPISODE_WINDOW_MINUTES, Math.round(observedSeconds / 60)),
    dominantSurface,
    currentSurfaceSeconds,
    transitions: transitions.map(({ surfaceKey: _surfaceKey, ...transition }) => transition),
  };
}

function uniqueSegments(segments: readonly ActivitySegment[]): ActivitySegment[] {
  const seen = new Set<string>();
  const unique: ActivitySegment[] = [];
  for (const segment of segments) {
    if (seen.has(segment.id)) continue;
    seen.add(segment.id);
    unique.push(segment);
  }
  return unique;
}

export function episodeContextDigestMaterial(episode: RecentEpisodePromptContext | null): string | null {
  if (!episode) return null;
  return JSON.stringify({
    dominantSurface: episode.dominantSurface,
    currentSurfaceBucket: durationBucket(episode.currentSurfaceSeconds),
    transitions: episode.transitions.map((transition) => ({
      appName: transition.appName,
      domain: transition.domain ?? null,
      title: transition.title ?? null,
      durationBucket: durationBucket(transition.durationSeconds),
    })),
  });
}

function continuousSuffix(segments: readonly ActivitySegment[], currentEndMs: number): ActivitySegment[] {
  if (segments.length === 0) return [];
  const selected: ActivitySegment[] = [];
  let nextStartMs = currentEndMs;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const startMs = timestampMs(segment.startedAt);
    const endMs = timestampMs(segment.endedAt);
    if (startMs === null || endMs === null) continue;
    if (nextStartMs - endMs > MAX_CONTINUITY_GAP_MS) break;
    selected.push(segment);
    nextStartMs = startMs;
  }
  return selected.reverse();
}

function compressTransitions(
  segments: readonly ActivitySegment[],
  privacySettings: AiPrivacyRequestSettings,
  durationFor: (segment: ActivitySegment) => number,
): MutableTransition[] {
  const transitions: MutableTransition[] = [];
  for (const segment of segments) {
    const transition = transitionForSegment(segment, privacySettings, durationFor(segment));
    const previous = transitions[transitions.length - 1];
    if (previous?.surfaceKey === transition.surfaceKey) {
      previous.durationSeconds += transition.durationSeconds;
      continue;
    }
    transitions.push(transition);
  }
  return transitions;
}

function transitionForSegment(
  segment: ActivitySegment,
  privacySettings: AiPrivacyRequestSettings,
  durationSeconds: number,
): MutableTransition {
  const appName = cleanText(segment.appName, 120) ?? "Unknown";
  const domain = cleanText(segment.siteDomain, 160) ?? hostnameFromUrl(segment.siteUrl);
  const titles = normalizeClassificationTitles({
    appName: segment.appName, bundleId: segment.bundleId, browserName: segment.browserName, siteDomain: domain,
    windowTitle: privacySettings.optional.windowTitle ? segment.windowTitle : null,
    title: privacySettings.optional.contentContext ? segment.siteTitle ?? segment.youtubeTitle : null,
  });
  const title = cleanText(titles.title ?? titles.windowTitle, MAX_TITLE_LENGTH);
  const surfaceKey = `${appName.toLocaleLowerCase()}|${domain?.toLocaleLowerCase() ?? ""}|${title?.toLocaleLowerCase() ?? ""}`;
  return {
    appName,
    ...(domain ? { domain } : {}),
    ...(title ? { title } : {}),
    durationSeconds,
    surfaceKey,
  };
}

function dominantSurfaceLabel(
  segments: readonly ActivitySegment[],
  durationFor: (segment: ActivitySegment) => number,
): string | null {
  const durations = new Map<string, number>();
  for (const segment of segments) {
    const label = cleanText(segment.siteDomain, 160) ?? cleanText(segment.appName, 120);
    if (!label) continue;
    durations.set(
      label,
      (durations.get(label) ?? 0) + durationFor(segment),
    );
  }
  let dominant: string | null = null;
  let dominantSeconds = -1;
  for (const [label, seconds] of durations) {
    if (seconds > dominantSeconds) {
      dominant = label;
      dominantSeconds = seconds;
    }
  }
  return dominant;
}

function currentSurfaceDurationSeconds(
  segments: readonly ActivitySegment[],
  durationFor: (segment: ActivitySegment) => number,
): number {
  const current = segments[segments.length - 1];
  if (!current) return 0;
  const key = broadSurfaceKey(current);
  let total = 0;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (broadSurfaceKey(segment) !== key) break;
    total += durationFor(segment);
  }
  return total;
}

function broadSurfaceKey(segment: ActivitySegment): string {
  return `${segment.appName.trim().toLocaleLowerCase()}|${(segment.siteDomain ?? "").trim().toLocaleLowerCase()}`;
}

function boundedDurationSeconds(segment: ActivitySegment): number {
  return Math.min(
    RECENT_EPISODE_WINDOW_MINUTES * 60,
    Math.max(0, Math.round(Number.isFinite(segment.durationSeconds) ? segment.durationSeconds : 0)),
  );
}

function observedDurationSeconds(segment: ActivitySegment, windowStartMs: number, currentEndMs: number): number {
  const startMs = timestampMs(segment.startedAt);
  const endMs = timestampMs(segment.endedAt);
  if (startMs === null || endMs === null) return boundedDurationSeconds(segment);
  const overlapMs = Math.max(0, Math.min(endMs, currentEndMs) - Math.max(startMs, windowStartMs));
  return Math.min(RECENT_EPISODE_WINDOW_MINUTES * 60, Math.round(overlapMs / 1_000));
}

function durationBucket(seconds: number): number {
  if (seconds < 30) return 15;
  if (seconds < 120) return 60;
  if (seconds < 300) return 180;
  if (seconds < 900) return 600;
  return 1_800;
}

function hostnameFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? cleanText(url.hostname, 160) : null;
  } catch {
    return null;
  }
}

function timestampMs(value: string): number | null {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function cleanText(value: string | null | undefined, maxLength: number): string | null {
  const cleaned = value
    ?.replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, maxLength).trim() || null : null;
}

export type { RecentEpisodePromptContext, RecentEpisodePromptTransition };
