import { capturedActivityDurationSeconds } from "./capturedActivityDuration";
import type { ActivityClassification, ActivitySegment } from "./activity";

const YOUTUBE_MUSIC_PLAYLIST_PREFIXES = ["RD", "RDMM", "RDAMVM", "RDCLAK", "RDAMPL", "OLAK"] as const;

const YOUTUBE_MUSIC_METADATA_CATEGORIES = new Set(["", "entertainment", "people & blogs"]);
export const YOUTUBE_FEED_DRIFT_MINIMUM_SECONDS = 30;

const YOUTUBE_MUSIC_METADATA_HINTS = [
  "music",
  "song",
  "songs",
  "ballad",
  "lyrics",
  "ost",
  "노래",
  "음악",
  "발라드",
] as const;

const YOUTUBE_OFFICIAL_CATEGORY_CLASSIFICATIONS: Readonly<Record<string, ActivityClassification>> = {
  "autos & vehicles": { category: "entertainment", productivity: "drift" },
  comedy: { category: "entertainment", productivity: "drift" },
  education: { category: "learning", productivity: "focus" },
  entertainment: { category: "entertainment", productivity: "drift" },
  "film & animation": { category: "entertainment", productivity: "drift" },
  gaming: { category: "game", productivity: "drift" },
  "howto & style": { category: "learning", productivity: "focus" },
  "how-to & style": { category: "learning", productivity: "focus" },
  music: { category: "music", productivity: "neutral" },
  "news & politics": { category: "entertainment", productivity: "drift" },
  "nonprofits & activism": { category: "entertainment", productivity: "drift" },
  "people & blogs": { category: "entertainment", productivity: "drift" },
  "pets & animals": { category: "entertainment", productivity: "drift" },
  "science & technology": { category: "learning", productivity: "focus" },
  sports: { category: "entertainment", productivity: "drift" },
  "travel & events": { category: "entertainment", productivity: "drift" },
};

/**
 * Why the YouTube rules reached their answer. `video` means a watched video
 * classified only from YouTube's official category (or the entertainment
 * fallback), so the topic of the video, not the surface, decides it.
 */
export type YouTubeClassificationBasis = "shorts" | "music" | "feed" | "browse" | "video";

export function classifyYouTubeActivity(segment: ActivitySegment): ActivityClassification | null {
  return classifyYouTubeActivityWithBasis(segment)?.classification ?? null;
}

/**
 * True when the built-in YouTube rule would decide this activity from the
 * video's official category rather than a surface signal (Shorts, music, feed,
 * or browse page). User category guidance can legitimately change those
 * answers, so such videos are sent to the classifier when guidance exists.
 */
export function isContentDependentYouTubeActivity(segment: ActivitySegment): boolean {
  return classifyYouTubeActivityWithBasis(segment)?.basis === "video";
}

export function classifyYouTubeActivityWithBasis(
  segment: ActivitySegment,
): { readonly classification: ActivityClassification; readonly basis: YouTubeClassificationBasis } | null {
  const site = normalizeYouTubeSite(segment.siteDomain);
  if (!isYouTubeSite(site)) return null;

  const playlistId = segment.youtubePlaylistId ?? playlistIdFromUrl(segment.siteUrl);
  const officialCategory = normalizeYouTubeOfficialCategory(segment.youtubeCategory ?? "");

  if (segment.youtubeIsShorts) {
    return { classification: { category: "entertainment", productivity: "drift" }, basis: "shorts" };
  }

  if (site === "music.youtube.com") {
    return { classification: { category: "music", productivity: "neutral" }, basis: "music" };
  }

  if (playlistId && isYouTubeMusicPlaylist(playlistId)) {
    return { classification: { category: "music", productivity: "neutral" }, basis: "music" };
  }

  if (isSustainedYouTubeFeedPage(segment)) {
    return { classification: { category: "entertainment", productivity: "drift" }, basis: "feed" };
  }

  if (isYouTubeBrowsePage(segment)) {
    // A capture taken mid in-page navigation can land with a bare base URL (no video id),
    // which looks like a browse page — but if the window title names a specific video the
    // user is watching one, so classify it as a video rather than an unknown home/feed page.
    // Only the bare base URL qualifies: search/feed/channel titles also end in " - YouTube",
    // so those pages must stay unknown for inheritance/AI to handle.
    if (youtubePathFromUrl(segment.siteUrl) === "/" && youTubeVideoNameFromWindowTitle(segment.windowTitle)) {
      return { classification: { category: "entertainment", productivity: "drift" }, basis: "video" };
    }
    return { classification: { category: "unknown", productivity: "neutral" }, basis: "browse" };
  }

  if (hasYouTubeMusicMetadata(segment, officialCategory)) {
    return { classification: { category: "music", productivity: "neutral" }, basis: "music" };
  }

  const categoryClassification = classifyYouTubeOfficialCategory(officialCategory);
  if (categoryClassification) {
    return {
      classification: categoryClassification,
      basis: categoryClassification.category === "music" ? "music" : "video",
    };
  }

  return { classification: { category: "entertainment", productivity: "drift" }, basis: "video" };
}

export function classifyYouTubeWindowTitle(segment: ActivitySegment): ActivityClassification | null {
  if (normalizeYouTubeSite(segment.siteDomain)) return null;

  const titleParts = normalizeText(segment.windowTitle).split(" - ").map((part) => part.trim());
  if (hasYouTubeWindowTitleSiteSuffix(titleParts, "youtube music")) return { category: "music", productivity: "neutral" };
  if (hasYouTubeWindowTitleSiteSuffix(titleParts, "youtube")) return { category: "entertainment", productivity: "drift" };
  return null;
}

export function isYouTubeSite(site: string): boolean {
  const normalizedSite = normalizeYouTubeSite(site);
  return normalizedSite === "youtube.com" || normalizedSite === "m.youtube.com" || normalizedSite === "music.youtube.com" || normalizedSite === "youtu.be";
}

export function isYouTubeBrowsePage(segment: ActivitySegment): boolean {
  const site = normalizeYouTubeSite(segment.siteDomain);
  if (!isYouTubeSite(site) || site === "music.youtube.com" || segment.youtubeVideoId) return false;

  const path = youtubePathFromUrl(segment.siteUrl);
  if (path === null) return false;
  if (path === "/" || path === "/results" || path === "/feed" || path.startsWith("/feed/")) return true;
  if (/^\/@[^/]+(?:\/.*)?$/.test(path)) return true;
  return path.startsWith("/channel/") || path.startsWith("/c/") || path.startsWith("/user/");
}

// The specific video name in a "<name> - YouTube[ - <status>][ - <app>]" window title,
// or null for the bare home/feed title ("YouTube") and non-video windows.
function youTubeVideoNameFromWindowTitle(windowTitle?: string | null): string | null {
  const title = (windowTitle ?? "").trim();
  if (!title) return null;
  const markerIndex = title.toLowerCase().indexOf(" - youtube");
  if (markerIndex <= 0) return null;
  const name = title.slice(0, markerIndex).trim();
  if (!name || name.toLowerCase() === "youtube") return null;
  return name;
}

export function isYouTubeFeedPage(segment: ActivitySegment): boolean {
  const site = normalizeYouTubeSite(segment.siteDomain);
  if (!isYouTubeSite(site) || site === "music.youtube.com" || segment.youtubeVideoId) return false;

  const path = youtubePathFromUrl(segment.siteUrl);
  return path === "/feed" || Boolean(path?.startsWith("/feed/"));
}

export function isSustainedYouTubeFeedPage(segment: ActivitySegment): boolean {
  return isYouTubeFeedPage(segment) && capturedActivityDurationSeconds(segment) >= YOUTUBE_FEED_DRIFT_MINIMUM_SECONDS;
}

export function isYouTubeVideoSegment(segment: ActivitySegment): boolean {
  const site = normalizeYouTubeSite(segment.siteDomain);
  if (!isYouTubeSite(site) || isYouTubeBrowsePage(segment)) return false;
  if (segment.youtubeVideoId || segment.youtubeIsShorts) return true;

  const path = youtubePathFromUrl(segment.siteUrl);
  if (site === "youtu.be") return Boolean(path && path !== "/");
  return Boolean(path && (path === "/watch" || path.startsWith("/shorts/")));
}

/**
 * Whether a segment is a YouTube Shorts video. Used by the sustained social
 * dwell hard rule to include Shorts alongside Instagram Reels, TikTok, etc.
 */
export function isYouTubeShortsSegment(segment: ActivitySegment): boolean {
  const site = normalizeYouTubeSite(segment.siteDomain);
  if (!isYouTubeSite(site)) return false;
  if (segment.youtubeIsShorts) return true;
  const path = youtubePathFromUrl(segment.siteUrl);
  return Boolean(path && path.startsWith("/shorts/"));
}

function hasYouTubeMusicMetadata(segment: ActivitySegment, officialCategory: string): boolean {
  if (!YOUTUBE_MUSIC_METADATA_CATEGORIES.has(officialCategory)) return false;
  return matchesAny(youtubeMetadataText(segment), YOUTUBE_MUSIC_METADATA_HINTS);
}

function youtubeMetadataText(segment: ActivitySegment): string {
  return [
    segment.youtubeTitle,
    segment.youtubeDescription,
    segment.youtubeKeywords?.join(" "),
  ].map((value) => normalizeText(value)).filter(Boolean).join(" ");
}

function normalizeYouTubeSite(site?: string | null): string {
  return normalizeDomain(site);
}

function playlistIdFromUrl(siteUrl?: string | null): string | null {
  if (!siteUrl) return null;
  try {
    return new URL(siteUrl).searchParams.get("list");
  } catch {
    return null;
  }
}

function youtubePathFromUrl(siteUrl?: string | null): string | null {
  if (!siteUrl) return null;
  try {
    return new URL(siteUrl).pathname || "/";
  } catch {
    return null;
  }
}

function isYouTubeMusicPlaylist(playlistId: string): boolean {
  const normalized = playlistId.trim().toUpperCase();
  return YOUTUBE_MUSIC_PLAYLIST_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function classifyYouTubeOfficialCategory(category: string): ActivityClassification | null {
  return YOUTUBE_OFFICIAL_CATEGORY_CLASSIFICATIONS[normalizeYouTubeOfficialCategory(category)] ?? null;
}

function hasYouTubeWindowTitleSiteSuffix(titleParts: readonly string[], sitePart: "youtube" | "youtube music"): boolean {
  const sitePartIndex = titleParts.indexOf(sitePart);
  if (sitePartIndex <= 0) return false;

  const nextPart = titleParts[sitePartIndex + 1] ?? "";
  if (isBrowserWindowTitleSuffix(nextPart)) return true;
  return isYouTubePlaybackStatusPart(nextPart) && titleParts.slice(sitePartIndex + 2).some(isBrowserWindowTitleSuffix);
}

function isBrowserWindowTitleSuffix(value: string): boolean {
  return BROWSER_WINDOW_TITLE_SUFFIXES.has(value);
}

function isYouTubePlaybackStatusPart(value: string): boolean {
  return YOUTUBE_PLAYBACK_STATUS_PARTS.has(value);
}

function normalizeYouTubeOfficialCategory(category: string): string {
  return category.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDomain(value?: string | null): string {
  return normalizeText(value).replace(/^www\./, "");
}

function normalizeText(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

const BROWSER_WINDOW_TITLE_SUFFIXES = new Set([
  "arc",
  "brave",
  "brave browser",
  "chrome",
  "chromium",
  "firefox",
  "google chrome",
  "google chrome canary",
  "microsoft edge",
  "mozilla firefox",
  "safari",
]);

const YOUTUBE_PLAYBACK_STATUS_PARTS = new Set([
  "audio playing",
  "오디오 재생",
]);

function matchesAny(value: string, hints: readonly string[]): boolean {
  return hints.some((hint) => value.includes(hint));
}
