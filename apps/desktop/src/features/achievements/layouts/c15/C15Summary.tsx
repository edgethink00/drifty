import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { achievementName, shownRarity } from "../../achievementCopy";
import { achievementHoldings, HELD_MEDALS, type HeldMedal } from "../../achievementCollection";
import { achievementTier, formatRarityPercent } from "../../achievementRarity";
import type { AchievementSummary } from "../../achievementSummary";
import type { AchievementItem } from "../../useAchievements";
import { C15Medal } from "./C15Medal";

type SummaryProps = {
  readonly summary: AchievementSummary;
  readonly className: string;
  /** Leave out "7 achievements" where something else already says it. */
  readonly withoutCount?: boolean;
};

/** How many are held, then the same count by rarity tier when every held one has a rarity, else by medal metal. */
export function C15Summary({ summary, className, withoutCount = false }: SummaryProps) {
  return (
    <div className={className} data-tier-summary={summary.kind ?? "none"}>
      {withoutCount ? null : <p className="c15-summary__count">{summary.held}</p>}
      {summary.parts.length > 0 ? (
        <p className="c15-summary__tiers">
          <span className="c15-sr">{summary.partsLabel}</span>
          {summary.parts.map(({ key, name, count }) => (
            <span key={key} className="c15-hold">
              <span className="c15-hold__name">{name}</span>
              <span className="c15-hold__count">{count}</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** Rare and above, rarest first; more than this and the line stops being a highlight. */
const RARE_SHOWN = 3;
const RARE_FROM_TIER = 3;

const MEDAL_KEYS: Readonly<Record<HeldMedal, TranslationKey>> = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ringShort",
};

/** Summary style "rare": only the rarest achievements held, each with its tier and share. Nothing when none is rare or rarity is unknown. */
export function C15RareSummary({ items }: { readonly items: readonly AchievementItem[] }) {
  const { effectiveLanguage, t } = useLocalization();
  const rare = items
    .filter((item) => item.earned)
    .map((item) => ({ item, rarity: shownRarity(item) }))
    .filter((entry): entry is { item: AchievementItem; rarity: NonNullable<typeof entry.rarity> } => entry.rarity !== null)
    .filter(({ item, rarity }) => achievementTier(item.definition, rarity) >= RARE_FROM_TIER)
    .sort((left, right) => left.rarity.percent - right.rarity.percent)
    .slice(0, RARE_SHOWN);
  if (rare.length === 0) return null;
  return (
    <div className="c15-summary c15-summary--rare" data-tier-summary="rarity">
      <p className="c15-rare__label">{t("achievements.c15.summary.rare")}</p>
      <ul className="c15-rare">
        {rare.map(({ item, rarity }) => (
          <li key={item.definition.id} className="c15-rare__item">
            <C15Medal item={item} small className="c15-medal c15-rare__medal" />
            <span className="c15-rare__name">{achievementName(item, t)}</span>
            <span className="c15-rare__tier">
              {t(("achievements.tier." + achievementTier(item.definition, rarity)) as TranslationKey)}
              {" "}
              <span className="c15-rare__percent">{t("achievements.c15.percent", { percent: formatRarityPercent(rarity.percent, effectiveLanguage) })}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Summary style "stats": the count held, then one cell per tier (or medal metal), common first, zeros kept but faint. */
export function C15StatsSummary({ items, summary }: { readonly items: readonly AchievementItem[]; readonly summary: AchievementSummary }) {
  const { t } = useLocalization();
  const holdings = achievementHoldings(items);
  if (!holdings) return <div className="c15-summary c15-summary--quiet" data-tier-summary="none"><p className="c15-summary__count">{summary.held}</p></div>;
  const cells = holdings.kind === "rarity"
    ? holdings.tiers.map(({ tier, count }) => ({ key: "tier-" + tier, name: t(("achievements.tier." + tier) as TranslationKey), count }))
    : HELD_MEDALS.map((medal) => ({ key: medal, name: t(MEDAL_KEYS[medal]), count: holdings.medals.find((entry) => entry.medal === medal)?.count ?? 0 }));
  return (
    <div className="c15-summary c15-summary--stats" data-tier-summary={holdings.kind}>
      <dl className="c15-stats">
        <div className="c15-stat c15-stat--total">
          <dt>{t("trends.tab.achievements")}</dt>
          <dd>{holdings.total}</dd>
        </div>
        {cells.map(({ key, name, count }) => (
          <div key={key} className="c15-stat" data-zero={count === 0 ? "true" : undefined}>
            <dt>{name}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
