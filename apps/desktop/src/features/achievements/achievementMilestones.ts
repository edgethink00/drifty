/** Counts at which a repeatable achievement reaches a new milestone. */
export const ACHIEVEMENT_MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1000] as const;

export type AchievementMilestoneProgress = {
  /** The milestone already reached. */
  readonly reached: number;
  /** The next one, with how many more times it takes. */
  readonly target: number;
  readonly remaining: number;
  /** Progress from the reached milestone to the next, 0–1. */
  readonly share: number;
};

/** Where a count stands between milestones; null before the first or past the last. */
export function achievementMilestoneProgress(count: number): AchievementMilestoneProgress | null {
  if (!Number.isFinite(count) || count < 1) return null;
  const target = ACHIEVEMENT_MILESTONES.find((milestone) => milestone > count);
  if (target === undefined) return null;
  const reached = [...ACHIEVEMENT_MILESTONES].reverse().find((milestone) => milestone <= count) ?? 1;
  return { reached, target, remaining: target - count, share: (count - reached) / (target - reached) };
}
