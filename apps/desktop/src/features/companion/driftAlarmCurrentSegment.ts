import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";
import { activitySegmentIdentity, currentSnapshotIdentity, getLatestWatcherSegment } from "./watcherData";

export type ActiveDriftAlarmSegment = {
  readonly alertKey: string;
  readonly segment: ActivitySegment;
  readonly sourceSegmentId: string;
};

export function getActiveDriftAlarmSegment(current: CurrentActivitySnapshot, segments: readonly ActivitySegment[]): ActiveDriftAlarmSegment | null {
  const latestSegment = getLatestWatcherSegment([...segments]);
  if (!latestSegment) return null;
  if (!currentSnapshotMatchesSegment(current, latestSegment)) return null;

  return {
    alertKey: `active:${latestSegment.id}`,
    segment: extendSegmentToCurrentSnapshot(latestSegment, current),
    sourceSegmentId: latestSegment.id,
  };
}

function currentSnapshotMatchesSegment(current: CurrentActivitySnapshot, segment: ActivitySegment): boolean {
  if (activitySegmentIdentity(segment) !== currentSnapshotIdentity(current)) return false;
  if (!isYouTubeActivity(current, segment)) return true;

  const currentVideoId = normalizedValue(current.youtubeVideoId);
  const segmentVideoId = normalizedValue(segment.youtubeVideoId);
  if (!currentVideoId || !segmentVideoId) return true;
  return currentVideoId === segmentVideoId;
}

function extendSegmentToCurrentSnapshot(segment: ActivitySegment, current: CurrentActivitySnapshot): ActivitySegment {
  const observedAtMs = new Date(current.observedAt).getTime();
  const endedAtMs = new Date(segment.endedAt).getTime();
  const elapsedSeconds = Number.isFinite(observedAtMs) && Number.isFinite(endedAtMs) && observedAtMs > endedAtMs
    ? Math.round((observedAtMs - endedAtMs) / 1000)
    : 0;
  const siteUrl = isYouTubeActivity(current, segment)
    ? segment.siteUrl ?? current.siteUrl ?? null
    : current.siteUrl ?? segment.siteUrl ?? null;

  return {
    ...segment,
    endedAt: elapsedSeconds > 0 ? current.observedAt : segment.endedAt,
    durationSeconds: segment.durationSeconds + elapsedSeconds,
    browserName: current.browserName ?? segment.browserName ?? null,
    siteDomain: current.siteDomain ?? segment.siteDomain ?? null,
    siteTitle: current.siteTitle ?? segment.siteTitle ?? null,
    siteUrl,
    windowTitle: current.windowTitle ?? segment.windowTitle ?? null,
    youtubeVideoId: current.youtubeVideoId ?? segment.youtubeVideoId ?? null,
    youtubePlaylistId: current.youtubePlaylistId ?? segment.youtubePlaylistId ?? null,
    youtubeIsShorts: current.youtubeIsShorts ?? segment.youtubeIsShorts ?? null,
  };
}

function isYouTubeActivity(current: CurrentActivitySnapshot, segment: ActivitySegment): boolean {
  return isYouTubeDomain(current.siteDomain) || isYouTubeDomain(segment.siteDomain);
}

function isYouTubeDomain(value?: string | null): boolean {
  const normalized = normalizedValue(value)?.replace(/^www\./, "") ?? "";
  return normalized === "youtube.com" || normalized === "m.youtube.com" || normalized === "music.youtube.com" || normalized === "youtu.be";
}

function normalizedValue(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized ? normalized : null;
}
