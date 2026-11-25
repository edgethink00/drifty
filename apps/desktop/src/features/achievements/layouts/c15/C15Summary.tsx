import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import type { Translate } from "../../../localization/translate";
import { achievementBadgeStage } from "../../achievementBadge";
import { achievementName, shownRarity } from "../../achievementCopy";
import { HELD_MEDALS, type HeldMedal } from "../../achievementCollection";
import { formatRarityPercent } from "../../achievementRarity";
import type { AchievementSummary, AchievementSummaryPart } from "../../achievementSummary";
import type { AchievementItem } from "../../useAchievements";
import { RARE_BELOW_PERCENT } from "./c15Copy";
import { C15Medal } from "./C15Medal";

const MEDAL_KEYS: Readonly<Record<HeldMedal, TranslationKey>> = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ringShort",
};

/** Held achievements fewer than RARE_BELOW_PERCENT of users have, rarest first. */
function rareHeld(items: readonly AchievementItem[]) {
  return items
    .filter((item) => item.earned)
    .map((item) => ({ item, rarity: shownRarity(item) }))
    .filter((entry): entry is { item: AchievementItem; rarity: NonNullable<typeof entry.rarity> } => entry.rarity !== null && entry.rarity.percent < RARE_BELOW_PERCENT)
    .sort((left, right) => left.rarity.percent - right.rarity.percent);
}

/**
 * c15 says rarity in plain words: no tier ladder. With rarity known the line
 * counts only the rare ones ("rare 2"); without it, medal metals as before.
 */
function plainParts(summary: AchievementSummary, items: readonly AchievementItem[], t: Translate): readonly AchievementSummaryPart[] {
  if (summary.kind !== "rarity") return summary.parts;
  const rare = rareHeld(items).length;
  return rare > 0 ? [{ key: "rare", name: t("achievements.c15.summary.rare"), count: rare }] : [];
}

type SummaryProps = {
  readonly summary: AchievementSummary;
  readonly items: readonly AchievementItem[];
  readonly className: string;
  /** Leave out "7 achievements" where something else already says it. */
  readonly withoutCount?: boolean;
};

/** How many are held, then how many of them are rare when rarity is known, else the count by medal metal. */
export function C15Summary({ summary, items, className, withoutCount = false }: SummaryProps) {
  const { t } = useLocalization();
  const parts = plainParts(summary, items, t);
  return (
    <div className={className} data-tier-summary={summary.kind ?? "none"}>
      {withoutCount ? null : <p className="c15-summary__count">{summary.held}</p>}
      {parts.length > 0 ? (
        <p className="c15-summary__tiers">
          {summary.kind === "medal" ? <span className="c15-sr">{summary.partsLabel}</span> : null}
          {parts.map(({ key, name, count }) => (
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

/** More than this and the line stops being a highlight. */
const RARE_SHOWN = 3;

/** Summary style "rare": only the rarest achievements held, each with the share of users who hold it. Nothing when none is rare or rarity is unknown. */
export function C15RareSummary({ items }: { readonly items: readonly AchievementItem[] }) {
  const { effectiveLanguage, t } = useLocalization();
  const rare = rareHeld(items).slice(0, RARE_SHOWN);
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
              <span className="c15-rare__percent">{t("achievements.c15.percent", { percent: formatRarityPercent(rarity.percent, effectiveLanguage) })}</span>
              {" "}
              {t("achievements.c15.whoHas")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Summary style "stats": the count held, the rare ones when rarity is known, then one cell per medal metal; zeros kept but faint. */
export function C15StatsSummary({ items, summary }: { readonly items: readonly AchievementItem[]; readonly summary: AchievementSummary }) {
  const { t } = useLocalization();
  const held = items.filter((item) => item.earned);
  if (held.length === 0) return <div className="c15-summary c15-summary--quiet" data-tier-summary="none"><p className="c15-summary__count">{summary.held}</p></div>;
  const cells = [
    ...(summary.kind === "rarity" ? [{ key: "rare", name: t("achievements.c15.summary.rare"), count: rareHeld(items).length }] : []),
    ...HELD_MEDALS.map((medal) => ({ key: medal, name: t(MEDAL_KEYS[medal]), count: held.filter((item) => achievementBadgeStage(item) === medal).length })),
  ];
  return (
    <div className="c15-summary c15-summary--stats" data-tier-summary={summary.kind ?? "none"}>
      <dl className="c15-stats">
        <div className="c15-stat c15-stat--total">
          <dt>{t("trends.tab.achievements")}</dt>
          <dd>{held.length}</dd>
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
