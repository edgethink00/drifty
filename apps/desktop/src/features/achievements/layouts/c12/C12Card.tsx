import type { CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementCondition, achievementName, medalName, rarityIsNotable, rarityTierName, shownRarity } from "../../achievementCopy";
import { achievementSummary } from "../../achievementSummary";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C12Holdings } from "./C12Holdings";
import { C12Medal } from "./C12Medal";
import { ordinal, rowDay, timesMark } from "./c12Copy";

/** A slice of the tab's ledger: medal, name with its condition, then rarity, ×count and day in shared columns. */
function CardRows({ items }: { readonly items: readonly AchievementItem[] }) {
  const { effectiveLanguage, t } = useLocalization();
  const anyRarity = items.some((item) => shownRarity(item) !== null);
  return (
    <ul className="c12-card__rows" data-rarity={anyRarity ? undefined : "none"}>
      {items.map((item, index) => {
        const rarity = shownRarity(item);
        return (
          <li key={item.definition.id} className="c12-card__row" style={{ "--c12-i": index } as CSSProperties}>
            <C12Medal item={item} className="c12-medal c12-card__row-medal" />
            <span className="c12-card__row-main">
              <span className="c12-card__row-name">{achievementName(item, t)}</span>
              <span className="c12-card__row-cond">{achievementCondition(item, t)}</span>
            </span>
            {anyRarity ? (
              <span className="c12-card__row-rarity" data-notable={rarity && rarityIsNotable(item, rarity) ? "true" : undefined}>
                {rarity ? rarityTierName(item, rarity, t) : null}
              </span>
            ) : null}
            <span className="c12-card__row-times">{timesMark(item)}</span>
            <span className="c12-card__row-date">{rowDay(item, effectiveLanguage)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The lead's one ledger line under its story: tier, which time, day, between hairlines. */
function LeadFacts({ lead }: { readonly lead: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const rarity = shownRarity(lead);
  const count = lead.earned?.count ?? 0;
  const tier = rarity ? rarityTierName(lead, rarity, t) : medalName(lead, t);
  const nth = lead.definition.repeatable && count > 1 ? ordinal(count, t, effectiveLanguage) : null;
  const day = rowDay(lead, effectiveLanguage);
  return (
    <p className="c12-card__facts">
      {tier ? <span className="c12-card__fact" data-notable={rarity && rarityIsNotable(lead, rarity) ? "true" : undefined}>{tier}</span> : null}
      {nth ? <span className="c12-card__fact c12-card__fact--strong">{nth}</span> : null}
      {day ? <span className="c12-card__fact">{day}</span> : null}
    </p>
  );
}

function Lead({ lead, titleId, eyebrow }: { readonly lead: AchievementItem; readonly titleId: string; readonly eyebrow: string }) {
  const { t } = useLocalization();
  return (
    <>
      <p className="c12-card__eyebrow">{eyebrow}</p>
      <div className="c12-card__stage">
        <C12Medal item={lead} className="c12-medal c12-card__hero" />
      </div>
      <div className="c12-card__text">
        <h2 id={titleId} className="c12-card__title">{achievementName(lead, t)}</h2>
        <p className="c12-card__condition">{achievementCondition(lead, t)}</p>
      </div>
      <LeadFacts lead={lead} />
    </>
  );
}

export function C12Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  return (
    <>
      {showFirstLook ? (
        <>
          <div className="c12-card__text c12-card__text--look">
            <h2 id={titleId} className="c12-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
            <p className="c12-card__condition">{t("achievements.dialog.firstLookBody")}</p>
            <C12Holdings summary={achievementSummary(ordered, t)} className="c12-card__tiers" />
          </div>
          <CardRows items={ordered} />
        </>
      ) : (
        <>
          <Lead
            lead={lead}
            titleId={titleId}
            eyebrow={others.length > 0 ? t("achievements.dialog.eyebrowMany", { count: ordered.length }) : t("achievements.dialog.eyebrow")}
          />
          {others.length > 0 ? (
            <section className="c12-card__also" aria-label={t("achievements.dialog.alsoEarned")}>
              <CardRows items={others} />
            </section>
          ) : null}
        </>
      )}
      <div className="c12-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
