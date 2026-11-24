import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { achievementHoldings } from "../../achievementCollection";
import type { AchievementItem } from "../../useAchievements";

const MEDAL_KEYS = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ringShort",
} as const satisfies Record<string, TranslationKey>;

/** What is held, by rarity tier when every held one has a rarity, else by medal metal. Tiers held zero times stay, dimmed. */
export function C12Holdings({ items, className }: { readonly items: readonly AchievementItem[]; readonly className: string }) {
  const { t } = useLocalization();
  const holdings = achievementHoldings(items);
  if (!holdings) return null;
  const parts = holdings.kind === "rarity"
    ? holdings.tiers.map(({ tier, count }) => ({ key: "tier-" + tier, name: t(("achievements.tier." + tier) as TranslationKey), count }))
    : holdings.medals.map(({ medal, count }) => ({ key: medal, name: t(MEDAL_KEYS[medal]), count }));
  return (
    <p className={className} data-tier-summary={holdings.kind}>
      <span className="c12-sr">{t(holdings.kind === "rarity" ? "achievements.c12.byRarity" : "achievements.c12.byMedal")}</span>
      {parts.map(({ key, name, count }) => (
        <span key={key} className="c12-hold" data-zero={count === 0 ? "true" : undefined}>
          <span className="c12-hold__name">{name}</span>
          <span className="c12-hold__count">{count}</span>
        </span>
      ))}
    </p>
  );
}
