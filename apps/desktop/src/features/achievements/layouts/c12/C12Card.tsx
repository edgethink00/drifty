import type { CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementCondition, achievementName } from "../../achievementCopy";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C12Holdings } from "./C12Holdings";
import { C12Medal } from "./C12Medal";
import { rowDay, tierLine, timesMark, whenLine } from "./c12Copy";

/** The same ledger line as the tab, without the columns a card has no room for. */
function CardRows({ items }: { readonly items: readonly AchievementItem[] }) {
  const { effectiveLanguage, t } = useLocalization();
  return (
    <ul className="c12-card__rows">
      {items.map((item, index) => {
        const times = timesMark(item);
        return (
          <li key={item.definition.id} className="c12-card__row" style={{ "--c12-i": index } as CSSProperties}>
            <C12Medal item={item} small className="c12-medal c12-card__row-medal" />
            <span className="c12-card__row-main">
              <span className="c12-card__row-name">{achievementName(item, t)}</span>
              <span className="c12-card__row-cond">{achievementCondition(item, t)}</span>
            </span>
            <span className="c12-card__row-times">{times}</span>
            <span className="c12-card__row-date">{rowDay(item, effectiveLanguage)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Lead({ lead, titleId, eyebrow }: { readonly lead: AchievementItem; readonly titleId: string; readonly eyebrow: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const when = whenLine(lead, t, effectiveLanguage);
  const tier = tierLine(lead, t, effectiveLanguage);
  return (
    <>
      <p className="c12-card__eyebrow">{eyebrow}</p>
      <div className="c12-card__stage">
        <C12Medal item={lead} className="c12-medal c12-card__hero" />
      </div>
      <div className="c12-card__text">
        <h2 id={titleId} className="c12-card__title">{achievementName(lead, t)}</h2>
        <p className="c12-card__condition">{achievementCondition(lead, t)}</p>
        {when ? <p className="c12-card__when">{when}</p> : null}
        {tier ? <p className="c12-card__tier">{tier}</p> : null}
      </div>
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
            <C12Holdings items={ordered} className="c12-card__tiers" />
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
