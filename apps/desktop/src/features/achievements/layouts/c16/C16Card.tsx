import { Fragment, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementCondition, achievementName, medalName, raritySentence, rarityTierName, shownRarity } from "../../achievementCopy";
import { historyFor } from "../../achievementHistory";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C16Medal } from "./C16Medal";
import { countAndDay, historyMonths, whenLine } from "./c16Copy";

/** Rows arrive one after another once the lead has settled. */
const ROWS_FROM_MS = 220;
const ROW_STEP_MS = 45;
const ROW_STEP_CAP = 8;
/** The card shows the rhythm, not the record: two months, a line each. */
const CARD_MONTHS = 2;
const CARD_DAYS_PER_MONTH = 8;

function CardHistory({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage } = useLocalization();
  const history = historyFor(item);
  if (!item.definition.repeatable || !history || history.days.length < 2) return null;
  const months = historyMonths(history.days, effectiveLanguage).slice(0, CARD_MONTHS);
  return (
    <ul className="c16-card__history">
      {months.map((month) => {
        const days = month.days.slice(0, CARD_DAYS_PER_MONTH);
        return (
          <li key={month.key} className="c16-card__month">
            <span className="c16-card__month-label">{month.label}</span>
            <span className="c16-card__days">
              {days.map((day, index) => (
                <Fragment key={day}>
                  {index > 0 ? <span className="c16-card__sep" aria-hidden="true">·</span> : null}
                  {Number(day.slice(8, 10))}
                </Fragment>
              ))}
              {month.days.length > days.length ? <span className="c16-card__sep" aria-hidden="true">…</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CardRows({ items, from }: { readonly items: readonly AchievementItem[]; readonly from: number }) {
  const { effectiveLanguage, t } = useLocalization();
  return (
    <ul className="c16-cardlist">
      {items.map((item, index) => {
        const fact = countAndDay(item, t, effectiveLanguage);
        const delay = from + Math.min(index, ROW_STEP_CAP) * ROW_STEP_MS;
        return (
          <li key={item.definition.id} className="c16-cardrow" style={{ "--c16-delay": delay + "ms" } as CSSProperties}>
            <C16Medal item={item} className="c16-medal c16-cardrow__medal" />
            <span className="c16-cardrow__name">{achievementName(item, t)}</span>
            {fact ? <span className="c16-cardrow__fact">{fact}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

type LeadProps = { readonly item: AchievementItem; readonly eyebrow: string; readonly titleId: string; readonly alone: boolean };

function Lead({ item, eyebrow, titleId, alone }: LeadProps) {
  const { effectiveLanguage, t } = useLocalization();
  const when = whenLine(item, t, effectiveLanguage);
  const rarity = shownRarity(item);
  const standing = rarity
    ? rarityTierName(item, rarity, t) + " · " + raritySentence(rarity, t, effectiveLanguage, "card")
    : medalName(item, t);
  return (
    <div className="c16-card__lead">
      <p className="c16-card__eyebrow">{eyebrow}</p>
      <C16Medal item={item} className="c16-medal c16-card__hero" />
      <h2 id={titleId} className="c16-card__title">{achievementName(item, t)}</h2>
      <p className="c16-card__condition">{achievementCondition(item, t)}</p>
      {when ? <p className="c16-card__when">{when}</p> : null}
      {alone ? <CardHistory item={item} /> : null}
      {standing ? <p className="c16-card__standing">{standing}</p> : null}
    </div>
  );
}

/** The new-achievement card: the medal large with plain text, others as checklist rows under it. */
export function C16Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  return (
    <>
      {showFirstLook ? (
        <>
          <div className="c16-card__look">
            <h2 id={titleId} className="c16-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
            <p className="c16-card__condition">{t("achievements.dialog.firstLookBody")}</p>
          </div>
          <CardRows items={ordered} from={ROWS_FROM_MS - 120} />
        </>
      ) : (
        <>
          <Lead
            item={lead}
            titleId={titleId}
            alone={others.length === 0}
            eyebrow={others.length > 0 ? t("achievements.dialog.eyebrowMany", { count: ordered.length }) : t("achievements.dialog.eyebrow")}
          />
          {others.length > 0 ? <CardRows items={others} from={ROWS_FROM_MS} /> : null}
        </>
      )}
      <div className="c16-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
