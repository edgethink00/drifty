import { isBrowserHistoryImportSegment, isRemoteDeviceSegment, isYouTubeSite } from "@drifty/domain";
import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";

/** Resolve only the latest local activity, never an older matching video or app. */
export function resolveWatcherCurrentSegment(
  current: CurrentActivitySnapshot,
  segments: readonly ActivitySegment[],
  freshnessSeconds: number,
): { segment: ActivitySegment; uncapturedSeconds: number } | null {
  let latest: ActivitySegment | null = null;
  let ambiguous = false;
  for (const segment of segments) {
    if (isRemoteDeviceSegment(segment) || isBrowserHistoryImportSegment(segment)) continue;
    const endedAt = Date.parse(segment.endedAt);
    const startedAt = Date.parse(segment.startedAt);
    if (!Number.isFinite(endedAt) || !Number.isFinite(startedAt)) continue;
    const endOrder = latest ? endedAt - Date.parse(latest.endedAt) : 1;
    const startOrder = latest ? startedAt - Date.parse(latest.startedAt) : 1;
    if (endOrder > 0 || (endOrder === 0 && startOrder > 0)) {
      latest = segment;
      ambiguous = false;
    } else if (endOrder === 0 && startOrder === 0 && latest?.id !== segment.id) {
      ambiguous = true;
    }
  }
  if (!latest || ambiguous || !sameCurrentActivity(current, latest)) return null;

  const observedAt = Date.parse(current.observedAt);
  const startedAt = Date.parse(latest.startedAt);
  const endedAt = Date.parse(latest.endedAt);
  if (![observedAt, startedAt, endedAt].every(Number.isFinite)) return null;
  const elapsedSeconds = (observedAt - endedAt) / 1_000;
  if (startedAt > endedAt || elapsedSeconds < 0 || elapsedSeconds > freshnessSeconds) return null;

  const uncapturedSeconds = Math.round(elapsedSeconds);
  return {
    uncapturedSeconds,
    segment: {
      ...latest,
      endedAt: current.observedAt,
      durationSeconds: latest.durationSeconds + uncapturedSeconds,
      windowTitle: current.windowTitle,
      siteTitle: current.siteTitle,
      siteUrl: current.siteUrl,
      classification: latest.classification?.stale ? null : latest.classification,
    },
  };
}

function sameCurrentActivity(current: CurrentActivitySnapshot, segment: ActivitySegment): boolean {
  if (text(current.appName) !== text(segment.appName)
    || text(current.bundleId) !== text(segment.bundleId)
    || text(current.browserName) !== text(segment.browserName)
    || text(current.siteDomain) !== text(segment.siteDomain)) return false;

  if (isYouTubeSite(current.siteDomain ?? "")) {
    const currentVideo = videoIdentity(current);
    const storedVideo = videoIdentity(segment);
    return currentVideo !== null && currentVideo === storedVideo;
  }

  // A domain or app name alone cannot identify the tab/document whose AI result
  // was stored. Require the captured URL and both titles to remain unchanged.
  return Boolean(text(current.siteUrl) || text(current.siteTitle) || text(current.windowTitle))
    && text(current.siteUrl) === text(segment.siteUrl)
    && text(current.siteTitle) === text(segment.siteTitle)
    && text(current.windowTitle) === text(segment.windowTitle);
}

function videoIdentity(activity: Pick<ActivitySegment, "siteUrl" | "youtubeVideoId" | "youtubeIsShorts">): string | null {
  const explicitId = text(activity.youtubeVideoId);
  let urlId: string | null = null;
  let shorts = activity.youtubeIsShorts === true;
  if (activity.siteUrl) {
    try {
      const url = new URL(activity.siteUrl);
      if (!isYouTubeSite(url.hostname)) return null;
      const shortsPath = url.pathname.startsWith("/shorts/");
      const shortHost = url.hostname === "youtu.be";
      if (!shortHost && !shortsPath && url.pathname !== "/watch") return null;
      shorts ||= shortsPath;
      urlId = text(shortHost || shortsPath
        ? url.pathname.split("/").filter(Boolean).pop()
        : url.searchParams.get("v"));
      if (!urlId) return null;
    } catch {
      return null;
    }
  }
  if (explicitId && urlId && explicitId !== urlId) return null;
  const id = explicitId ?? urlId;
  // YouTube IDs are case-sensitive; only playback URL parameters may differ.
  return id ? `${shorts ? "shorts" : "watch"}:${id}` : null;
}

function text(value: string | null | undefined): string | null {
  return value?.trim() || null;
}
