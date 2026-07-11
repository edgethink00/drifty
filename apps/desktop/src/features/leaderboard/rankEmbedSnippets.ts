import type { LeaderboardPeriod } from "./leaderboardService";
import type { BadgeThemeOption } from "../share/embedSnippets";

const EMBED_ORIGIN = "https://drifty.so";

export type RankEmbedOptions = {
  readonly period?: LeaderboardPeriod;
  readonly theme?: BadgeThemeOption;
};

export function buildRankEmbedUrl(publicId: string, options: RankEmbedOptions = {}): string {
  const params = new URLSearchParams({
    id: publicId,
    view: "rank",
  });
  if (options.period && options.period !== "weekly") params.set("period", options.period);
  if (options.theme === "dark") params.set("theme", "dark");
  return `${EMBED_ORIGIN}/embed/?${params.toString()}`;
}

export function buildRankEmbedSnippet(publicId: string, options: RankEmbedOptions = {}): string {
  const src = buildRankEmbedUrl(publicId, options);
  return `<iframe src="${src}" width="380" height="154" style="border:0;overflow:hidden" scrolling="no" title="Drifty leaderboard rank"></iframe>`;
}
