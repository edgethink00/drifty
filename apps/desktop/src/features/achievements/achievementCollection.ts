import { closestAchievements, progressShare } from "./achievementProgress";
import type { AchievementItem } from "./useAchievements";

/** One goal close to done: a locked achievement already under way. */
export type AlmostThereEntry = {
  readonly item: AchievementItem;
  /** How far along, 0–1. */
  readonly share: number;
};

/** The achievements under way, furthest along first. Hidden achievements stay out until earned. */
export function almostThere(items: readonly AchievementItem[], { limit = 3 }: { readonly limit?: number } = {}): AlmostThereEntry[] {
  return closestAchievements(items, items.length).map((item) => ({ item, share: progressShare(item) })).slice(0, limit);
}
