import type { TranslationKey } from "../../../localization/translations";
import type { Translate } from "../../../localization/translate";
import { achievementBadgeStage, achievementBadgeUrl } from "../../achievementBadge";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { AchievementHoldings, AlmostThereEntry } from "../../achievementCollection";
import { shownRarity } from "../../achievementCopy";
import { nextMedal, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";

/** The medal image as baked; its box is sized by the layout's CSS. */
export function C8Medal({ item, small = false, className = "c8-medal" }: { readonly item: AchievementItem; readonly small?: boolean; readonly className?: string }) {
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage, small);
  return (
    <span className={className} data-stage={stage} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : null}
    </span>
  );
}

/** What an almost-there goal still needs: time or days for an unlock, times for the next metal. */
export function goalLeft({ item, kind }: AlmostThereEntry, t: Translate, language: DisplayLanguage): string {
  const medal = kind === "medal" ? nextMedal(item) : null;
  return medal ? t(medal.key, { remaining: medal.remaining }) : remainingText(item, t, language) ?? "";
}

export function timesEarned(item: AchievementItem): number | null {
  return item.definition.repeatable && item.earned && item.earned.count > 1 ? item.earned.count : null;
}

export function Multiplier({ item, t, className = "c8-x" }: { readonly item: AchievementItem; readonly t: Translate; readonly className?: string }) {
  const count = timesEarned(item);
  return count ? <span className={className}>{t("achievements.c8.multiplier", { count })}</span> : null;
}

const STAGE_RANK: Readonly<Record<string, number>> = { ring: 3, gold: 2, silver: 1 };

/**
 * The medals a strip puts forward: the rarest earned when rarity is known for
 * all of them, else the highest metal, then the most often earned.
 */
export function featuredMedals(items: readonly AchievementItem[], holdings: AchievementHoldings | null, limit = 3): AchievementItem[] {
  const held = items.filter((item) => item.earned);
  const byRarity = holdings?.kind === "rarity";
  return [...held]
    .sort((left, right) => (byRarity ? (shownRarity(left)?.percent ?? 100) - (shownRarity(right)?.percent ?? 100) : 0)
      || (STAGE_RANK[achievementBadgeStage(right)] ?? 0) - (STAGE_RANK[achievementBadgeStage(left)] ?? 0)
      || (right.earned?.count ?? 0) - (left.earned?.count ?? 0)
      || right.definition.weight - left.definition.weight)
    .slice(0, limit);
}

/** One quiet count row: by rarity tier with rarity, by medal metal without. */
export function TierSummary({ holdings, t }: { readonly holdings: AchievementHoldings; readonly t: Translate }) {
  const entries = holdings.kind === "rarity"
    ? holdings.tiers.map(({ tier, count }) => ({ key: "t" + tier, count, name: t(("achievements.tier." + tier) as TranslationKey) }))
    : holdings.medals.map(({ medal, count }) => ({
      key: medal,
      count,
      name: t(medal === "ring" ? "achievements.medal.ringShort" : medal === "gold" ? "achievements.medal.gold" : "achievements.medal.silver"),
    }));
  return (
    <ul className="c8-tiers" data-tier-summary={holdings.kind} aria-label={t(holdings.kind === "rarity" ? "achievements.c8.byTier" : "achievements.c8.byMedal")}>
      {entries.map((entry) => (
        <li key={entry.key} className="c8-tiers__item" data-empty={entry.count === 0 ? "true" : undefined}>
          <span className="c8-tiers__count">{entry.count}</span>
          <span className="c8-tiers__name">{entry.name}</span>
        </li>
      ))}
    </ul>
  );
}
