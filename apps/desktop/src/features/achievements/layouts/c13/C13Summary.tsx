import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { achievementHoldings } from "../../achievementCollection";
import type { AchievementItem } from "../../useAchievements";

const MEDAL_KEYS = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ringShort",
} as const satisfies Record<string, TranslationKey>;

/** One quiet line: how many are held, then what is held by rarity tier (or by medal metal without rarity). */
export function C13Summary({ items, earnedCount }: { readonly items: readonly AchievementItem[]; readonly earnedCount: number }) {
  const { t } = useLocalization();
  const holdings = achievementHoldings(items);
  const parts = !holdings ? []
    : holdings.kind === "rarity"
      ? holdings.tiers.filter(({ count }) => count > 0).map(({ tier, count }) => ({ key: "tier-" + tier, name: t(("achievements.tier." + tier) as TranslationKey), count }))
      : holdings.medals.filter(({ count }) => count > 0).map(({ medal, count }) => ({ key: medal, name: t(MEDAL_KEYS[medal]), count }));
  return (
    <p className="c13-summary" data-tier-summary={holdings?.kind ?? "none"}>
      <span className="c13-summary__count">{t("achievements.c13.held", { earned: earnedCount, total: items.length })}</span>
      {parts.length > 0 ? (
        <span className="c13-summary__tiers">
          <span className="c13-sr">{t(holdings?.kind === "rarity" ? "achievements.c13.byRarity" : "achievements.c13.byMedal")}</span>
          {parts.map(({ key, name, count }) => (
            <span key={key} className="c13-hold">
              <span className="c13-hold__name">{name}</span>
              <span className="c13-hold__count">{count}</span>
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}
