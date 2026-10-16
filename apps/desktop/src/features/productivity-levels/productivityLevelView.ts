import type { ActivityCategory, ProductivityLabel, ProductivityLevel } from "@drifty/domain";
import type { CompactRingEntry } from "../dashboard/CompactRingChart";

/*
 * Added productivity levels on the app's charts (owner decision 2026-10-16:
 * a level is a fourth productivity beside focus, neutral, and drift). A
 * level's time is the neutral time of the categories fixed to it, so every
 * score (focus share, leaderboard, share card) still counts it as neutral;
 * these helpers split that neutral time out under the level's name and color.
 */

/** The added level a piece of activity shows under: neutral time in a category fixed to it. */
export function levelFor(category: ActivityCategory, productivity: ProductivityLabel, levels: readonly ProductivityLevel[]): ProductivityLevel | null {
  if (productivity !== "neutral" || levels.length === 0) return null;
  return levels.find((level) => level.categories.includes(category)) ?? null;
}

/** The productivity a chart files activity under: an added level's id, or the label itself. */
export function productivityKeyFor(category: ActivityCategory, productivity: ProductivityLabel, levels: readonly ProductivityLevel[]): string {
  return levelFor(category, productivity, levels)?.id ?? productivity;
}

/** Neutral seconds per category, from a list of category totals that carries them. */
export function neutralSecondsByCategory(entries: readonly { readonly category: ActivityCategory; readonly neutralSeconds?: number }[]): (category: ActivityCategory) => number {
  const byCategory = new Map(entries.map((entry) => [entry.category, entry.neutralSeconds ?? 0]));
  return (category) => byCategory.get(category) ?? 0;
}

function levelSeconds(levels: readonly ProductivityLevel[], neutralSeconds: (category: ActivityCategory) => number, neutralTotal: number): Map<string, number> {
  const result = new Map<string, number>();
  let left = neutralTotal;
  for (const level of levels) {
    const seconds = Math.min(left, level.categories.reduce((sum, category) => sum + neutralSeconds(category), 0));
    if (seconds > 0) result.set(level.id, seconds);
    left -= seconds;
  }
  return result;
}

/** The productivity donut's entries with each added level split out of neutral, right after it. */
export function withLevelRingEntries(
  entries: readonly CompactRingEntry[],
  levels: readonly ProductivityLevel[],
  neutralSeconds: (category: ActivityCategory) => number,
): CompactRingEntry[] {
  const neutral = entries.find((entry) => entry.key === "neutral");
  if (!neutral || levels.length === 0) return [...entries];
  const byLevel = levelSeconds(levels, neutralSeconds, neutral.totalSeconds);
  if (byLevel.size === 0) return [...entries];
  const levelTotal = [...byLevel.values()].reduce((sum, seconds) => sum + seconds, 0);
  const share = (seconds: number) => (neutral.totalSeconds > 0 ? neutral.ratio * (seconds / neutral.totalSeconds) : 0);
  const rest = neutral.totalSeconds - levelTotal;
  return entries.flatMap((entry): CompactRingEntry[] => (entry.key !== "neutral" ? [entry] : [
    {
      ...entry,
      totalSeconds: rest,
      ratio: share(rest),
      matchesBlock: (block) => entry.matchesBlock(block) && levelFor(block.category, block.productivity, levels) === null,
    },
    ...levels.flatMap((level): CompactRingEntry[] => {
      const seconds = byLevel.get(level.id) ?? 0;
      return seconds > 0 ? [{
        key: level.id,
        label: level.name,
        color: level.color,
        totalSeconds: seconds,
        ratio: share(seconds),
        matchesBlock: (block) => levelFor(block.category, block.productivity, levels)?.id === level.id,
        dotClassName: "productivity-dot--" + level.id,
      }] : [];
    }),
  ]));
}

export type LevelSlice = { readonly key: string; readonly seconds: number; readonly color: string; readonly label: string };

/** One day's productivity slices with each added level split out of neutral, right after it. */
export function withLevelSlices(
  slices: readonly LevelSlice[],
  levels: readonly ProductivityLevel[],
  neutralSeconds: (category: ActivityCategory) => number,
): LevelSlice[] {
  const neutral = slices.find((slice) => slice.key === "neutral");
  if (!neutral || levels.length === 0) return [...slices];
  const byLevel = levelSeconds(levels, neutralSeconds, neutral.seconds);
  const levelTotal = [...byLevel.values()].reduce((sum, seconds) => sum + seconds, 0);
  return slices.flatMap((slice) => (slice.key !== "neutral" ? [slice] : [
    ...(slice.seconds - levelTotal > 0 ? [{ ...slice, seconds: slice.seconds - levelTotal }] : []),
    ...levels.flatMap((level) => {
      const seconds = byLevel.get(level.id) ?? 0;
      return seconds > 0 ? [{ key: level.id, seconds, color: level.color, label: level.name }] : [];
    }),
  ]));
}
