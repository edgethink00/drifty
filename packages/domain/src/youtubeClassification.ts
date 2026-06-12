import type { ActivityClassification, ActivitySegment } from "./activity";

const YOUTUBE_MUSIC_PLAYLIST_PREFIXES = ["RD", "RDMM", "RDAMVM", "RDCLAK", "RDAMPL", "OLAK"] as const;

const YOUTUBE_MUSIC_METADATA_CATEGORIES = new Set(["", "entertainment", "people & blogs"]);

const YOUTUBE_MUSIC_METADATA_HINTS = [
  "music",
  "playlist",
  "song",
  "songs",
  "ballad",
  "lyrics",
  "ost",
  "플레이리스트",
  "노래",
  "음악",
  "발라드",
  "플리",
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

  if (isYouTubeBrowsePage(segment)) {
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
  if (titleParts.includes("youtube music")) return { category: "music", productivity: "neutral" };
  if (titleParts.includes("youtube")) return { category: "entertainment", productivity: "drift" };
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

export const isYouTubeNavigationPage = isYouTubeBrowsePage;

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

function normalizeYouTubeOfficialCategory(category: string): string {
  return category.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDomain(value?: string | null): string {
  return normalizeText(value).replace(/^www\./, "");
}

function normalizeText(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function matchesAny(value: string, hints: readonly string[]): boolean {
  return hints.some((hint) => value.includes(hint));
}
