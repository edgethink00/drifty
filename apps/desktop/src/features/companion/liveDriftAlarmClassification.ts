import { isYouTubeBrowsePage, isYouTubeVideoSegment } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

export function segmentForLiveDriftAlarmClassification(
  segment: ActivitySegment,
  historySegments: readonly ActivitySegment[] = [],
): ActivitySegment {
  const classificationSegment = withMatchingYouTubeHistoryMetadata(segment, historySegments);
  if (!isYouTubeBrowsePage(classificationSegment)) return classificationSegment;
  return { ...classificationSegment, classification: null };
}

function withMatchingYouTubeHistoryMetadata(segment: ActivitySegment, historySegments: readonly ActivitySegment[]): ActivitySegment {
  if (!isYouTubeVideoSegment(segment)) return segment;

  const matchingSegment = findMatchingYouTubeHistorySegment(segment, historySegments);
  if (!matchingSegment) return segment;

  return {
    ...segment,
    siteUrl: segment.siteUrl ?? matchingSegment.siteUrl ?? null,
    youtubePlaylistId: segment.youtubePlaylistId ?? matchingSegment.youtubePlaylistId ?? playlistIdFromUrl(matchingSegment.siteUrl),
    youtubeCategory: segment.youtubeCategory ?? matchingSegment.youtubeCategory ?? null,
    youtubeTitle: segment.youtubeTitle ?? matchingSegment.youtubeTitle ?? null,
    youtubeDescription: segment.youtubeDescription ?? matchingSegment.youtubeDescription ?? null,
    youtubeKeywords: segment.youtubeKeywords ?? matchingSegment.youtubeKeywords ?? null,
  };
}

function findMatchingYouTubeHistorySegment(segment: ActivitySegment, historySegments: readonly ActivitySegment[]): ActivitySegment | null {
  const videoId = youtubeVideoId(segment);
  if (!videoId) return null;

  let bestMatch: ActivitySegment | null = null;
  let bestEndedAtMs = Number.NEGATIVE_INFINITY;
  for (const historySegment of historySegments) {
    if (historySegment.id === segment.id) continue;
    if (!isYouTubeVideoSegment(historySegment)) continue;
    if (youtubeVideoId(historySegment) !== videoId) continue;

    const endedAtMs = new Date(historySegment.endedAt).getTime();
    const matchEndedAtMs = Number.isFinite(endedAtMs) ? endedAtMs : Number.NEGATIVE_INFINITY;
    if (matchEndedAtMs >= bestEndedAtMs) {
      bestMatch = historySegment;
      bestEndedAtMs = matchEndedAtMs;
    }
  }

  return bestMatch;
}

function youtubeVideoId(segment: ActivitySegment): string | null {
  const explicitId = normalizedValue(segment.youtubeVideoId);
  if (explicitId) return explicitId;

  const siteUrl = segment.siteUrl?.trim();
  if (!siteUrl) return null;

  try {
    const url = new URL(siteUrl);
    if (url.hostname.toLowerCase().replace(/^www\./, "") === "youtu.be") {
      return normalizedValue(url.pathname.split("/").filter(Boolean)[0]);
    }
    return normalizedValue(url.searchParams.get("v"));
  } catch {
    return null;
  }
}

function playlistIdFromUrl(siteUrl?: string | null): string | null {
  if (!siteUrl) return null;

  try {
    return normalizedValue(new URL(siteUrl).searchParams.get("list"));
  } catch {
    return null;
  }
}

function normalizedValue(value?: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}
