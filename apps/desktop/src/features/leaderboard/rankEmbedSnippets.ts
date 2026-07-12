import type { LeaderboardPeriod } from "./leaderboardService";
import type { BadgeThemeOption } from "../share/embedSnippets";
import { buildProfileUrl } from "../share/embedSnippets";

const EMBED_ORIGIN = "https://drifty.so";

/** Default rank accent (the badge green); omitted from URLs. */
export const RANK_EMBED_DEFAULT_ACCENT = "#2e9e4f";

export type RankEmbedDesign = "card" | "compact" | "minimal";

export type RankEmbedOptions = {
  readonly period?: LeaderboardPeriod;
  readonly theme?: BadgeThemeOption;
  /** Accent hex like "#6366f1"; the default green is omitted from URLs. */
  readonly accent?: string;
  /** Card layout variant; the default "card" is omitted from URLs. */
  readonly design?: RankEmbedDesign;
};

/** iframe heights per design so the snippet fits without scrolling. */
const DESIGN_IFRAME_HEIGHT: Record<RankEmbedDesign, number> = {
  card: 154,
  compact: 64,
  minimal: 118,
};

function accentParam(accent: string | undefined): string | null {
  if (!accent) return null;
  const normalized = accent.trim().toLowerCase();
  if (normalized === RANK_EMBED_DEFAULT_ACCENT) return null;
  const hex = normalized.replace(/^#/, "");
  return /^[0-9a-f]{6}$/.test(hex) ? hex : null;
}

function appendOptions(params: URLSearchParams, options: RankEmbedOptions): void {
  if (options.period && options.period !== "weekly") params.set("period", options.period);
  if (options.theme === "dark") params.set("theme", "dark");
  const accent = accentParam(options.accent);
  if (accent) params.set("accent", accent);
}

function appendDesign(params: URLSearchParams, options: RankEmbedOptions): void {
  if (options.design && options.design !== "card") params.set("design", options.design);
}

/** Hosted iframe rank-card URL (drifty.so/embed, rank view). */
export function buildRankEmbedUrl(publicId: string, options: RankEmbedOptions = {}): string {
  const params = new URLSearchParams({ id: publicId, view: "rank" });
  appendOptions(params, options);
  appendDesign(params, options);
  return `${EMBED_ORIGIN}/embed/?${params.toString()}`;
}

/** Website <iframe> snippet for the rank card. */
export function buildRankEmbedSnippet(publicId: string, options: RankEmbedOptions = {}): string {
  const src = buildRankEmbedUrl(publicId, options);
  const height = DESIGN_IFRAME_HEIGHT[options.design ?? "card"];
  return `<iframe src="${src}" width="380" height="${height}" style="border:0;overflow:hidden" scrolling="no" title="Drifty leaderboard rank"></iframe>`;
}

/** Rank badge image URL (drifty.so/embed/badge → Supabase badge fn, rank view). */
export function buildRankBadgeUrl(publicId: string, options: RankEmbedOptions = {}): string {
  const params = new URLSearchParams({ id: publicId, view: "rank" });
  appendOptions(params, options);
  return `${EMBED_ORIGIN}/embed/badge?${params.toString()}`;
}

/** GitHub README / Markdown: rank badge image linking to the public profile. */
export function buildRankMarkdownSnippet(publicId: string, options: RankEmbedOptions = {}): string {
  return `[![Drifty rank](${buildRankBadgeUrl(publicId, options)})](${buildProfileUrl(publicId)})`;
}
