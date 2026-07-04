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

export function classifyYouTubeActivity(segment: ActivitySegment): ActivityClassification | null {
  const site = normalizeYouTubeSite(segment.siteDomain);
  if (!isYouTubeSite(site)) return null;

  const playlistId = segment.youtubePlaylistId ?? playlistIdFromUrl(segment.siteUrl);
  const officialCategory = normalizeYouTubeOfficialCategory(segment.youtubeCategory ?? "");

  if (segment.youtubeIsShorts) {
    return { category: "entertainment", productivity: "drift" };
  }

  if (site === "music.youtube.com") {
    return { category: "music", productivity: "neutral" };
  }

  if (playlistId && isYouTubeMusicPlaylist(playlistId)) {
    return { category: "music", productivity: "neutral" };
  }

  if (isSustainedYouTubeFeedPage(segment)) {
    return { category: "entertainment", productivity: "drift" };
  }

  if (isYouTubeBrowsePage(segment)) {
    // A capture taken mid in-page navigation can land with a bare base URL (no video id),
    // which looks like a browse page — but if the window title names a specific video the
    // user is watching one, so classify it as a video rather than an unknown home/feed page.
    if (youTubeVideoNameFromWindowTitle(segment.windowTitle)) {
      return { category: "entertainment", productivity: "drift" };
    }
    return { category: "unknown", productivity: "neutral" };
  }

  if (hasYouTubeMusicMetadata(segment, officialCategory)) {
    return { category: "music", productivity: "neutral" };
  }

  const categoryClassification = classifyYouTubeOfficialCategory(officialCategory);
  if (categoryClassification) return categoryClassification;

  return { category: "entertainment", productivity: "drift" };
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

export const isYouTubeNavigationPage = isYouTubeBrowsePage;

export function isYouTubeFeedPage(segment: ActivitySegment): boolean {
  const site = normalizeYouTubeSite(segment.siteDomain);
  if (!isYouTubeSite(site) || site === "music.youtube.com" || segment.youtubeVideoId) return false;

  const path = youtubePathFromUrl(segment.siteUrl);
  return path === "/feed" || Boolean(path?.startsWith("/feed/"));
}

export function isSustainedYouTubeFeedPage(segment: ActivitySegment): boolean {
  return isYouTubeFeedPage(segment) && segment.durationSeconds >= YOUTUBE_FEED_DRIFT_MINIMUM_SECONDS;
}

export function isYouTubeVideoSegment(segment: ActivitySegment): boolean {
  const site = normalizeYouTubeSite(segment.siteDomain);
  if (!isYouTubeSite(site) || isYouTubeBrowsePage(segment)) return false;
  if (segment.youtubeVideoId || segment.youtubeIsShorts) return true;

  const path = youtubePathFromUrl(segment.siteUrl);
  if (site === "youtu.be") return Boolean(path && path !== "/");
  return Boolean(path && (path === "/watch" || path.startsWith("/shorts/")));
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
