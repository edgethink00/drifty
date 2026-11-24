import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { achievementHoldings } from "../../achievementCollection";
import type { AchievementItem } from "../../useAchievements";

const MEDAL_KEYS = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ringShort",
} as const satisfies Record<string, TranslationKey>;

/**
 * How many are held, then the same count by rarity tier when every held one
 * has a rarity, else by medal metal. Tiers held zero times stay, dimmed.
 */
export function C15Summary({ items, className }: { readonly items: readonly AchievementItem[]; readonly className: string }) {
  const { t } = useLocalization();
  const holdings = achievementHoldings(items);
  const earned = items.filter((item) => item.earned).length;
  const parts = !holdings ? [] : holdings.kind === "rarity"
    ? holdings.tiers.map(({ tier, count }) => ({ key: "tier-" + tier, name: t(("achievements.tier." + tier) as TranslationKey), count }))
    : holdings.medals.map(({ medal, count }) => ({ key: medal, name: t(MEDAL_KEYS[medal]), count }));
  return (
    <div className={className} data-tier-summary={holdings?.kind ?? "none"}>
      <p className="c15-summary__count">{t("achievements.summary", { earned, total: items.length })}</p>
      {holdings ? (
        <p className="c15-summary__tiers">
          <span className="c15-sr">{t(holdings.kind === "rarity" ? "achievements.c15.byRarity" : "achievements.c15.byMedal")}</span>
          {parts.map(({ key, name, count }) => (
            <span key={key} className="c15-hold" data-zero={count === 0 ? "true" : undefined}>
              <span className="c15-hold__name">{name}</span>
              <span className="c15-hold__count">{count}</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
