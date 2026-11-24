import { achievementDay, shownRarity } from "./achievementCopy";
import { almostThere, type AlmostThereEntry } from "./achievementCollection";
import { progressShare } from "./achievementProgress";
import { achievementTier } from "./achievementRarity";
import type { AchievementItem } from "./useAchievements";

/** How earned rows are ordered: latest day first, fewest holders first, or most times first. */
export type EarnedRowOrder = "recent" | "rarest" | "most";

/**
 * The achievements in list order for a single-column list of rows: what is
 * almost done, then what is earned, then what is not yet, with the hidden ones
 * last. Every achievement lands in exactly one part.
 */
export type AchievementRowParts = {
  /** Locked achievements under way, furthest along first. */
  readonly almost: readonly AlmostThereEntry[];
  readonly earned: readonly AchievementItem[];
  /** Locked, not hidden, and not in `almost`: furthest along first, then catalogue order. */
  readonly notYet: readonly AchievementItem[];
  /** Hidden and not earned yet, in catalogue order. */
  readonly hidden: readonly AchievementItem[];
};

function byRecent(left: AchievementItem, right: AchievementItem): number {
  return (achievementDay(right) ?? "").localeCompare(achievementDay(left) ?? "")
    || right.definition.weight - left.definition.weight;
}

/** Fewest holders first; without rarity the catalogue's sense of difficulty stands in. */
function byRarest(left: AchievementItem, right: AchievementItem): number {
  const leftRarity = shownRarity(left);
  const rightRarity = shownRarity(right);
  if (leftRarity && rightRarity && leftRarity.percent !== rightRarity.percent) return leftRarity.percent - rightRarity.percent;
  return achievementTier(right.definition, rightRarity) - achievementTier(left.definition, leftRarity) || byRecent(left, right);
}

function byMost(left: AchievementItem, right: AchievementItem): number {
  return (right.earned?.count ?? 0) - (left.earned?.count ?? 0) || byRecent(left, right);
}

const EARNED_ORDER: Readonly<Record<EarnedRowOrder, (left: AchievementItem, right: AchievementItem) => number>> = {
  recent: byRecent,
  rarest: byRarest,
  most: byMost,
};

/**
 * Split the achievements into list order. `almost` caps how many under-way
 * goals lead the list (Infinity: every one under way); the rest wait in
 * `notYet`, still furthest along first.
 */
export function achievementRowParts(
  items: readonly AchievementItem[],
  { almost = 3, earned = "recent" }: { readonly almost?: number; readonly earned?: EarnedRowOrder } = {},
): AchievementRowParts {
  const leading = almost > 0 ? almostThere(items, { limit: almost, medals: false }) : [];
  const leadingIds = new Set(leading.map((entry) => entry.item.definition.id));
  const catalogue = new Map(items.map((item, index) => [item.definition.id, index]));
  return {
    almost: leading,
    earned: items.filter((item) => item.earned).sort(EARNED_ORDER[earned]),
    notYet: items
      .filter((item) => !item.earned && !item.definition.hidden && !leadingIds.has(item.definition.id))
      .sort((left, right) => progressShare(right) - progressShare(left)
        || (catalogue.get(left.definition.id) ?? 0) - (catalogue.get(right.definition.id) ?? 0)),
    hidden: items.filter((item) => !item.earned && item.definition.hidden),
  };
}
