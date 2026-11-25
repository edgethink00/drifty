import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languagePreference";
import type { Translate } from "../localization/translate";
import type { TranslationKey } from "../localization/translations";
import { GOLD_FROM_COUNT, RING_FROM_COUNT } from "./achievementBadge";
import type { AchievementId } from "./achievementCatalog";
import { daysLabel } from "./achievementCopy";
import type { AchievementItem } from "./useAchievements";

export function progressShare(item: AchievementItem): number {
  const progress = item.progress;
  if (!progress || progress.target <= 0) return 0;
  return Math.max(0, Math.min(1, progress.current / progress.target));
}

export function progressText(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const progress = item.progress;
  if (!progress || progress.current <= 0) return null;
  if (progress.unit === "days") return t("achievements.daysProgress", { current: progress.current, target: progress.target });
  return formatLocalizedCompactDurationFromSeconds(progress.current, language) + " / " + formatLocalizedCompactDurationFromSeconds(progress.target, language);
}

export function remainingText(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const progress = item.progress;
  if (!progress) return null;
  const left = Math.max(0, progress.target - progress.current);
  return t("achievements.left", {
    amount: progress.unit === "days" ? daysLabel(left, t) : formatLocalizedCompactDurationFromSeconds(left, language),
  });
}

/**
 * Achievements whose progress carries on from here, a running total or a
 * streak still going, so what is left really is left. Every other bar
 * measures the best so far (the best day, run or weekend), which today's work
 * does not add to.
 */
const CARRIES_ON: ReadonlySet<AchievementId> = new Set<AchievementId>(["focus100h", "streak7", "streak30"]);

export function carriesOn(item: AchievementItem): boolean {
  return CARRIES_ON.has(item.definition.id);
}

/** The word beside a bar: "38h to go" or "16 days to go" where progress carries on, "Best so far 6h 26m" for the rest. */
export function progressNote(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const progress = item.progress;
  if (!progress) return null;
  if (carriesOn(item)) return remainingText(item, t, language);
  const amount = progress.unit === "days" ? daysLabel(progress.current, t) : formatLocalizedCompactDurationFromSeconds(progress.current, language);
  return t("achievements.bestSoFar", { amount });
}

/** Locked achievements already under way, closest to done first. Hidden ones stay out until earned. */
export function closestAchievements(items: readonly AchievementItem[], limit = 2): AchievementItem[] {
  return items
    .filter((item) => !item.earned && !item.definition.hidden && item.progress !== null
      && item.progress.current > 0 && item.progress.current < item.progress.target)
    .sort((left, right) => progressShare(right) - progressShare(left))
    .slice(0, limit);
}

/** How far a repeatable medal is from its next metal: gold at ten times, a double rim at fifty. */
export function nextMedal(item: AchievementItem): { readonly key: TranslationKey; readonly remaining: number; readonly share: number } | null {
  const count = item.earned?.count ?? 0;
  if (!item.earned || !item.definition.repeatable) return null;
  if (count < GOLD_FROM_COUNT) return { key: "achievements.medal.toGold", remaining: GOLD_FROM_COUNT - count, share: count / GOLD_FROM_COUNT };
  if (count < RING_FROM_COUNT) return { key: "achievements.medal.toRing", remaining: RING_FROM_COUNT - count, share: (count - GOLD_FROM_COUNT) / (RING_FROM_COUNT - GOLD_FROM_COUNT) };
  return null;
}
