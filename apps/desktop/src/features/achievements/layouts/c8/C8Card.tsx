import { useMemo, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { achievementHoldings, almostThere } from "../../achievementCollection";
import { achievementCondition, achievementName, formatAchievementDay, shownRarity } from "../../achievementCopy";
import { REVIEW_RARITY, useAchievementReviewState } from "../../achievementDesignReview";
import { achievementTier } from "../../achievementRarity";
import { readAchievementStore } from "../../achievementStore";
import { buildAchievementItems, type AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C8Medal, Multiplier, TierSummary, featuredMedals, goalLeft, timesEarned } from "./c8Parts";

const STEP_MS = 60;

function delay(ms: number): CSSProperties {
  return { "--c8-delay": ms + "ms" } as CSSProperties;
}

/** Every achievement as it stands now: the saved record with the new ones laid over it, rarity as the tab gets it. */
function useCollection(fresh: readonly AchievementItem[]): AchievementItem[] {
  const { mockRarity } = useAchievementReviewState();
  return useMemo(() => {
    const byId = new Map(fresh.map((item) => [item.definition.id, item]));
    return buildAchievementItems(readAchievementStore(), mockRarity ? REVIEW_RARITY : {}).map((item) => byId.get(item.definition.id) ?? item);
  }, [fresh, mockRarity]);
}

function Lead({ item, collection, titleId, compact }: { readonly item: AchievementItem; readonly collection: readonly AchievementItem[]; readonly titleId: string; readonly compact: boolean }) {
  const { effectiveLanguage, t } = useLocalization();
  const earned = item.earned;
  const times = timesEarned(item);
  const date = earned ? formatAchievementDay(item.definition.repeatable ? earned.lastDay : earned.firstDay, effectiveLanguage) : null;
  const holdings = achievementHoldings(collection);
  const rarity = shownRarity(item);
  const tier = holdings?.kind === "rarity" && rarity ? achievementTier(item.definition, rarity) : null;
  const tierCount = holdings?.kind === "rarity" && tier ? holdings.tiers.find((entry) => entry.tier === tier)?.count ?? 0 : 0;
  const next = compact ? undefined : almostThere(collection, { limit: 1 })[0];

  return (
    <>
      <div className="c8-stage c8-card__stage" data-stage="earned">
        <C8Medal item={item} className="c8-medal c8-card__medal" />
      </div>
      <div className="c8-card__text">
        <div className="c8-card__title c8-in" style={delay(STEP_MS * 3)}>
          <h2 id={titleId} className="c8-card__name">{achievementName(item, t)}</h2>
          <Multiplier item={item} t={t} className="c8-x c8-x--title" />
        </div>
        <p className="c8-card__meaning c8-in" style={delay(STEP_MS * 4)}>{achievementCondition(item, t)}</p>
        {date ? (
          <p className="c8-card__meta c8-in" style={delay(STEP_MS * 5)}>
            {times ? [t("achievements.c8.nth", { count: times }), date].join(" · ") : t("achievements.dialog.earnedOn", { date })}
          </p>
        ) : null}
        {tier ? (
          <p className="c8-card__tier c8-in" style={delay(STEP_MS * 6)}>
            {t("achievements.c8.joinsTier", { tier: t(("achievements.tier." + tier) as TranslationKey), count: tierCount })}
          </p>
        ) : null}
        {next ? (
          <p className="c8-card__next c8-in" style={delay(STEP_MS * 7)}>
            {t("achievements.c8.nextGoal", { name: achievementName(next.item, t), left: goalLeft(next, t, effectiveLanguage) })}
          </p>
        ) : null}
      </div>
    </>
  );
}

function MedalRow({ items, titleId, title, startAt }: { readonly items: readonly AchievementItem[]; readonly titleId: string; readonly title: string; readonly startAt: number }) {
  const { t } = useLocalization();
  return (
    <section className="c8-card__more c8-in" style={delay(startAt)} aria-labelledby={titleId}>
      <h3 id={titleId} className="c8-card__more-title">{title}</h3>
      <ul className="c8-card__row" data-count={items.length}>
        {items.map((item, index) => (
          <li key={item.definition.id} className="c8-card__slot c8-in" style={delay(startAt + STEP_MS + index * 50)}>
            <span className="c8-medal-wrap">
              <C8Medal item={item} className="c8-medal c8-card__slot-medal" />
              <Multiplier item={item} t={t} className="c8-x c8-x--medal" />
            </span>
            <span className="c8-card__slot-name">{achievementName(item, t)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const collection = useCollection(ordered);
  const holdings = useMemo(() => achievementHoldings(ordered), [ordered]);
  const featured = useMemo(() => featuredMedals(ordered, holdings), [ordered, holdings]);
  const rest = ordered.filter((item) => !featured.includes(item));
  const total = collection.length;
  return (
    <>
      <div className="c8-card__head">
        <h2 id={titleId} className="c8-card__name c8-in">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c8-card__meaning c8-in" style={delay(STEP_MS)}>{t("achievements.dialog.firstLookBody")}</p>
      </div>
      <div className="c8-mini c8-in" style={delay(STEP_MS * 2)}>
        <div className="c8-held">
          <p className="c8-held__count">
            <span className="c8-held__n">{ordered.length}</span>
            <span className="c8-held__of">/ {total}</span>
          </p>
          <span className="c8-bar c8-held__bar" aria-hidden="true"><span style={{ width: Math.round((ordered.length / Math.max(1, total)) * 100) + "%" }} /></span>
          <p className="c8-held__label">{t("achievements.c8.collected")}</p>
        </div>
        {holdings ? <TierSummary holdings={holdings} t={t} /> : null}
        <ul className="c8-mini__featured" aria-label={t("achievements.c8.featured")}>
          {featured.map((item, index) => (
            <li key={item.definition.id} className="c8-mini__medal c8-pop" style={delay(STEP_MS * 4 + index * 80)}>
              <span className="c8-medal-wrap">
                <C8Medal item={item} className="c8-medal c8-mini__img" />
                <Multiplier item={item} t={t} className="c8-x c8-x--medal" />
              </span>
              <span className="c8-card__slot-name">{achievementName(item, t)}</span>
            </li>
          ))}
        </ul>
      </div>
      {rest.length > 0 ? <MedalRow items={rest} titleId={titleId + "-rest"} title={t("achievements.dialog.alsoEarned")} startAt={STEP_MS * 6} /> : null}
    </>
  );
}

/** The new-achievement card in the record sheet's grammar: a medal stage, the name with its count, then what it adds. */
export function C8Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  const collection = useCollection(ordered);
  return (
    <div className="c8-card">
      {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} /> : (
        <>
          <Lead item={lead} collection={collection} titleId={titleId} compact={others.length > 0} />
          {others.length > 0 ? (
            <MedalRow items={others} titleId={titleId + "-more"} title={t("achievements.dialog.alsoEarned")} startAt={STEP_MS * 6} />
          ) : null}
        </>
      )}
      <div className="c8-card__actions c8-in" style={delay(STEP_MS * 8)}>
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </div>
  );
}
