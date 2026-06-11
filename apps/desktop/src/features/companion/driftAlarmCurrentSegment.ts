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

  return {
    ...segment,
    endedAt: elapsedSeconds > 0 ? current.observedAt : segment.endedAt,
    durationSeconds: segment.durationSeconds + elapsedSeconds,
    browserName: segment.browserName ?? current.browserName ?? null,
    siteDomain: segment.siteDomain ?? current.siteDomain ?? null,
    siteTitle: segment.siteTitle ?? current.siteTitle ?? null,
    siteUrl: segment.siteUrl ?? current.siteUrl ?? null,
    windowTitle: segment.windowTitle ?? current.windowTitle ?? null,
    youtubeVideoId: segment.youtubeVideoId ?? current.youtubeVideoId ?? null,
    youtubePlaylistId: segment.youtubePlaylistId ?? current.youtubePlaylistId ?? null,
    youtubeIsShorts: segment.youtubeIsShorts ?? current.youtubeIsShorts ?? null,
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
