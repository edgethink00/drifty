import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { achievementHoldings } from "../../achievementCollection";
import type { AchievementItem } from "../../useAchievements";

const MEDAL_KEYS = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ringShort",
} as const satisfies Record<string, TranslationKey>;

/** What is held, read as one line: the count, then the tiers (or medal metals) actually held. */
export function C16Summary({ items, className }: { readonly items: readonly AchievementItem[]; readonly className: string }) {
  const { t } = useLocalization();
  const earned = items.filter((item) => item.earned).length;
  const holdings = achievementHoldings(items);
  const parts = !holdings ? [] : holdings.kind === "rarity"
    ? holdings.tiers.map(({ tier, count }) => ({ key: "tier-" + tier, name: t(("achievements.tier." + tier) as TranslationKey), count }))
    : holdings.medals.map(({ medal, count }) => ({ key: medal, name: t(MEDAL_KEYS[medal]), count }));
  const held = parts.filter(({ count }) => count > 0);
  return (
    <p className={className} data-tier-summary={holdings?.kind}>
      <span className="c16-summary__held">{t("achievements.summary", { earned, total: items.length })}</span>
      {holdings && held.length > 0 ? (
        <span className="c16-summary__tiers">
          <span className="c16-sr">{t(holdings.kind === "rarity" ? "achievements.c16.byRarity" : "achievements.c16.byMedal")}</span>
          {held.map(({ key, name, count }) => (
            <span key={key} className="c16-hold">
              {name} <span className="c16-hold__count">{count}</span>
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}
