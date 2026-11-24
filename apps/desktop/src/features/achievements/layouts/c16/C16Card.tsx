import type { CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementCondition, achievementName, medalName, raritySentence, rarityTierName, shownRarity } from "../../achievementCopy";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C16Medal } from "./C16Medal";
import { cardFact, whenLine } from "./c16Copy";

/** Rows arrive one after another once the lead has settled. */
const ROWS_FROM_MS = 220;
const ROW_STEP_MS = 45;
const ROW_STEP_CAP = 8;

function CardRows({ items, from }: { readonly items: readonly AchievementItem[]; readonly from: number }) {
  const { effectiveLanguage, t } = useLocalization();
  return (
    <ul className="c16-cardlist">
      {items.map((item, index) => {
        const fact = cardFact(item, t, effectiveLanguage);
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

function Lead({ item, eyebrow, titleId }: { readonly item: AchievementItem; readonly eyebrow: string; readonly titleId: string }) {
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
      {when || standing ? (
        <p className="c16-card__meta">
          {when ? <span>{when}</span> : null}
          {standing ? <span>{standing}</span> : null}
        </p>
      ) : null}
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
