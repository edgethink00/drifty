import { achievementBadgeStage } from "./achievementBadge";
import { shownRarity } from "./achievementCopy";
import { closestAchievements, nextMedal, progressShare } from "./achievementProgress";
import { ACHIEVEMENT_TIERS, achievementTier, type AchievementTier } from "./achievementRarity";
import type { AchievementItem } from "./useAchievements";

/** Earned medal metals, in the order a medal passes through them. */
export const HELD_MEDALS = ["silver", "gold", "ring"] as const;
export type HeldMedal = typeof HELD_MEDALS[number];

/**
 * What the person holds, counted for one summary line. With rarity known for
 * every earned achievement it counts by rarity tier (common → legendary);
 * otherwise by medal metal, which needs no data from anyone else. Null when
 * nothing is earned yet.
 */
export type AchievementHoldings =
  | { readonly kind: "rarity"; readonly total: number; readonly tiers: readonly { readonly tier: AchievementTier; readonly count: number }[] }
  | { readonly kind: "medal"; readonly total: number; readonly medals: readonly { readonly medal: HeldMedal; readonly count: number }[] };

export function achievementHoldings(items: readonly AchievementItem[]): AchievementHoldings | null {
  const held = items.filter((item) => item.earned);
  if (held.length === 0) return null;
  if (held.every((item) => shownRarity(item) !== null)) {
    return {
      kind: "rarity",
      total: held.length,
      tiers: ACHIEVEMENT_TIERS.map((tier) => ({
        tier,
        count: held.filter((item) => achievementTier(item.definition, shownRarity(item)) === tier).length,
      })),
    };
  }
  return {
    kind: "medal",
    total: held.length,
    medals: HELD_MEDALS.map((medal) => ({ medal, count: held.filter((item) => achievementBadgeStage(item) === medal).length })),
  };
}

/**
 * One goal close to done: a locked achievement already under way ("unlock"),
 * or an earned repeatable one nearing its next metal ("medal").
 */
export type AlmostThereEntry = {
  readonly item: AchievementItem;
  readonly kind: "unlock" | "medal";
  /** How far along, 0–1. */
  readonly share: number;
};

/**
 * The goals closest to done, furthest along first: achievements under way,
 * then (when asked) repeatable ones nearing gold or a double rim. Hidden
 * achievements stay out until earned.
 */
export function almostThere(items: readonly AchievementItem[], { limit = 3, medals = true }: { readonly limit?: number; readonly medals?: boolean } = {}): AlmostThereEntry[] {
  const unlock: AlmostThereEntry[] = closestAchievements(items, items.length).map((item) => ({ item, kind: "unlock", share: progressShare(item) }));
  const medal: AlmostThereEntry[] = medals
    ? items.flatMap((item) => {
      const next = nextMedal(item);
      return next ? [{ item, kind: "medal" as const, share: next.share }] : [];
    })
    : [];
  return [...unlock, ...medal].sort((left, right) => right.share - left.share).slice(0, limit);
}
