import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementCondition, achievementDay, achievementName, formatAchievementDay } from "../../achievementCopy";
import { AchievementMedal } from "../../AchievementMedal";
import { formatRarityPercent } from "../../achievementRarity";
import type { AchievementLayoutCardProps } from "../types";
import { BeforeShowcase } from "./BeforeShowcase";
import "./before.css";

/** Awards standing behind the lead one when several arrive together. */
const FIRST_LOOK_COMPANIONS = 4;

export function BeforeCard({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { effectiveLanguage, t } = useLocalization();

  return (
    <>
      <div className="achievement-unlock__stage" data-group={lead.definition.group}>
        {!showFirstLook ? (
          <BeforeShowcase item={lead} size="hero" entrance />
        ) : (
          <div className="achievement-unlock__fan">
            <BeforeShowcase item={lead} size="hero" entrance />
            {others.slice(0, FIRST_LOOK_COMPANIONS).map((item) => <AchievementMedal key={item.definition.id} item={item} size="md" />)}
          </div>
        )}
      </div>
      {showFirstLook ? (
        <div className="achievement-unlock__body">
          <h2 id={titleId} className="achievement-unlock__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
          <p className="achievement-unlock__condition">{t("achievements.dialog.firstLookBody")}</p>
        </div>
      ) : (
        <div className="achievement-unlock__body">
          <p className="achievement-unlock__eyebrow">{t("achievements.dialog.eyebrow")}</p>
          <h2 id={titleId} className="achievement-unlock__title">{achievementName(lead, t)}</h2>
          <p className="achievement-unlock__condition">{achievementCondition(lead, t)}</p>
          {lead.rarity ? (
            <p className="achievement-unlock__rarity">{t("achievements.before.rarity.card", { percent: formatRarityPercent(lead.rarity.percent, effectiveLanguage) })}</p>
          ) : null}
          {lead.earned ? <p className="achievement-unlock__date">{formatAchievementDay(achievementDay(lead) ?? lead.earned.firstDay, effectiveLanguage)}</p> : null}
          {others.length > 0 ? (
            <div className="achievement-unlock__more">
              <span className="achievement-unlock__more-medals" aria-hidden="true">
                {others.slice(0, 3).map((item) => <AchievementMedal key={item.definition.id} item={item} size="sm" />)}
              </span>
              <span>{t("achievements.before.dialog.more", { count: others.length })}</span>
            </div>
          ) : null}
        </div>
      )}
      <div className="achievement-unlock__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
