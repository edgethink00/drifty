import { useMemo, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_GROUPS } from "../../achievementCatalog";
import { achievementHoldings, almostThere } from "../../achievementCollection";
import { achievementCondition, achievementName, formatAchievementDay, raritySentence, rarityIsNotable, rarityTierName, shownRarity } from "../../achievementCopy";
import { historyEntries, historyFor } from "../../achievementHistory";
import { readAchievementStore } from "../../achievementStore";
import { buildAchievementItems, type AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C11LitMedal, C11Medal, C11TierSummary, nearLeft, nthLabel } from "./c11Parts";
import "./c11-card.css";

/** When the first of the other new medals lights on the shelf row, then one after another. */
const SHELF_LIT_AT_MS = 620;
const SHELF_LIT_STEP_MS = 90;
const LOOK_LIT_AT_MS = 360;
const LOOK_LIT_STEP_MS = 55;

/** The whole collection as it stands now: the new ones as given, the rest from the saved record. */
function collectionWith(fresh: readonly AchievementItem[]): AchievementItem[] {
  const byId = new Map(fresh.map((item) => [item.definition.id, item]));
  return buildAchievementItems(readAchievementStore()).map((item) => byId.get(item.definition.id) ?? item);
}

type LeadProps = {
  readonly item: AchievementItem;
  readonly titleId: string;
  readonly eyebrow: string;
  /** How many of the newest days the little timeline shows. */
  readonly days: number;
};

/** The stage in miniature: the medal arriving with which time it is, its name and meaning, the tier it joins and its newest days. */
function Lead({ item, titleId, eyebrow, days }: LeadProps) {
  const { effectiveLanguage, t } = useLocalization();
  const rarity = shownRarity(item);
  const history = historyFor(item);
  const entries = history ? historyEntries(history) : [];
  const shown = entries.slice(0, days);
  const beyond = entries.length - shown.length + (history?.earlier ?? 0);
  return (
    <div className="c11-card__stage">
      <div className="c11-card__jewel">
        <C11Medal item={item} className="c11-medal c11-card__medal" />
        <span className="c11-card__nth">{nthLabel(item.earned?.count ?? 1, t, effectiveLanguage)}</span>
      </div>
      <div className="c11-card__text">
        <p className="c11-card__eyebrow">{eyebrow}</p>
        <h2 id={titleId} className="c11-card__title">{achievementName(item, t)}</h2>
        <p className="c11-card__condition">{achievementCondition(item, t)}</p>
        {rarity ? (
          <p className="c11-card__tier">
            <span className="c11-card__tier-name" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</span>
            <span>{raritySentence(rarity, t, effectiveLanguage, "card")}</span>
          </p>
        ) : null}
        {shown.length > 0 ? (
          <div className="c11-card__timeline" style={{ "--c11-days": shown.length } as CSSProperties}>
            <ol className="c11-card__days">
              {shown.map((entry, index) => (
                <li key={entry.day} className="c11-card__day" data-new={index === 0 ? "true" : undefined}>
                  <span className="c11-card__day-nth">{nthLabel(entry.ordinal, t, effectiveLanguage)}</span>
                  <span className="c11-card__day-date">{formatAchievementDay(entry.day, effectiveLanguage)}</span>
                </li>
              ))}
            </ol>
            {beyond > 0 ? (
              <p className="c11-card__beyond">{beyond === 1 ? t("achievements.c11.earlierOne") : t("achievements.c11.earlier", { count: beyond })}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Single({ lead, titleId }: { readonly lead: AchievementItem; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const next = useMemo(() => almostThere(collectionWith([lead]), { limit: 1 })[0], [lead]);
  return (
    <>
      <Lead item={lead} titleId={titleId} eyebrow={t("achievements.dialog.eyebrow")} days={3} />
      {next ? (
        <div className="c11-card__next">
          <p className="c11-card__next-label">{t("achievements.c11.nextGoal")}</p>
          <div className="c11-card__next-row">
            <C11Medal item={next.item} small className="c11-medal c11-card__next-medal" />
            <span className="c11-card__next-text">
              <span className="c11-card__next-name">{achievementName(next.item, t)}</span>
              <span className="c11-card__next-left">{nearLeft(next, t, effectiveLanguage)}</span>
            </span>
            <span className="c11-bar c11-card__next-bar" aria-hidden="true"><span style={{ width: Math.round(next.share * 100) + "%" }} /></span>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Several at once: the lead on the stage, the others standing on one shelf beneath, each lighting in turn. */
function Several({ ordered, lead, others, titleId }: { readonly ordered: readonly AchievementItem[]; readonly lead: AchievementItem; readonly others: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const title = t("achievements.dialog.alsoEarned");
  return (
    <>
      <Lead item={lead} titleId={titleId} eyebrow={t("achievements.dialog.eyebrowMany", { count: ordered.length })} days={2} />
      <section className="c11-card__shelf" aria-label={title}>
        <p className="c11-card__shelf-title" aria-hidden="true">{title}</p>
        <div className="c11-card__row">
          {others.map((item, index) => (
            <span key={item.definition.id} className="c11-card__slot" data-new="true">
              <C11LitMedal item={item} className="c11-medal c11-card__slot-medal" delay={SHELF_LIT_AT_MS + index * SHELF_LIT_STEP_MS} />
              <span className="c11-card__slot-name">{achievementName(item, t)}</span>
              <span className="c11-card__slot-nth">{(item.earned?.count ?? 1) > 1 ? "×" + item.earned?.count : t("achievements.c11.firstTime")}</span>
            </span>
          ))}
        </div>
      </section>
    </>
  );
}

/** The first look back: what was found, counted by tier, on the four shelves. */
function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const holdings = achievementHoldings(ordered);
  const found = new Map(ordered.map((item) => [item.definition.id, item]));
  let lit = 0;
  return (
    <>
      <div className="c11-card__look-head">
        <h2 id={titleId} className="c11-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c11-card__condition">{t("achievements.dialog.firstLookBody")}</p>
        {holdings ? <C11TierSummary holdings={holdings} className="c11-tiers c11-card__tiers" /> : null}
      </div>
      <div className="c11-card__shelves">
        {ACHIEVEMENT_GROUPS.map((group) => {
          const groupItems = ACHIEVEMENT_DEFINITIONS.filter((definition) => definition.group === group)
            .map((definition) => found.get(definition.id) ?? { definition, earned: null, progress: null, rarity: null });
          const label = t(("achievements.group." + group) as TranslationKey);
          return (
            <section key={group} className="c11-card__look-shelf" aria-label={label}>
              <p className="c11-card__look-title" aria-hidden="true">
                <span>{label}</span>
                <span className="c11-card__look-count">{groupItems.filter((item) => item.earned).length}/{groupItems.length}</span>
              </p>
              <div className="c11-card__row c11-card__row--look">
                {groupItems.map((item) => (
                  <span key={item.definition.id} className="c11-card__slot" data-new={item.earned ? "true" : undefined}>
                    {item.earned
                      ? <C11LitMedal item={item} small className="c11-medal c11-card__slot-medal" delay={LOOK_LIT_AT_MS + lit++ * LOOK_LIT_STEP_MS} />
                      : <C11Medal item={item} small className="c11-medal c11-card__slot-medal" />}
                    <span className="c11-card__slot-name">{achievementName(item, t)}</span>
                  </span>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

export function C11Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  return (
    <>
      {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} />
        : others.length > 0 ? <Several ordered={ordered} lead={lead} others={others} titleId={titleId} />
          : <Single lead={lead} titleId={titleId} />}
      <div className="c11-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
