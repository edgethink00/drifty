import type { CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementCondition, achievementName, raritySentence, shownRarity } from "../../achievementCopy";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C15Medal, C15SpinMedal } from "./C15Medal";
import { medalEngraving, rowFact } from "./c15Copy";

/** Rows past this many arrive together, so a long first look still settles quickly. */
const STAGGERED_ROWS = 6;

function Story({ item, titleId, level }: { readonly item: AchievementItem; readonly titleId?: string; readonly level: "single" | "lead" }) {
  const { effectiveLanguage, t } = useLocalization();
  const rarity = shownRarity(item);
  return (
    <div className={"c15-card__story c15-card__story--" + level}>
      <h2 id={titleId} className="c15-card__title">{achievementName(item, t)}</h2>
      <p className="c15-card__condition">{achievementCondition(item, t)}</p>
      {rarity && level === "single" ? <p className="c15-card__rarity">{raritySentence(rarity, t, effectiveLanguage, "card")}</p> : null}
    </div>
  );
}

/** A found achievement as a row: medal, name over condition, the one strong fact on the right. */
function CardRow({ item, index }: { readonly item: AchievementItem; readonly index: number }) {
  const { t } = useLocalization();
  return (
    <li className="c15-cardrow" style={{ "--c15-i": Math.min(index, STAGGERED_ROWS) } as CSSProperties}>
      <C15Medal item={item} className="c15-medal c15-cardrow__medal" />
      <span className="c15-cardrow__text">
        <span className="c15-cardrow__name">{achievementName(item, t)}</span>
        <span className="c15-cardrow__condition">{achievementCondition(item, t)}</span>
      </span>
      <CardFact item={item} />
    </li>
  );
}

function CardFact({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const fact = rowFact(item, t, effectiveLanguage);
  return (
    <span className="c15-cardrow__fact" data-kind={fact?.kind} data-notable={fact?.notable ? "true" : undefined}>
        {fact ? (
          <>
            <span className="c15-cardrow__figure">{fact.figure}</span>
            <span className="c15-cardrow__word">{fact.word}</span>
          </>
        ) : null}
      </span>
  );
}

function Single({ lead, titleId }: { readonly lead: AchievementItem; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  return (
    <>
      {/* The card is shown only the first time an achievement is earned, so it needs no "new" word or count; screen readers still hear it. */}
      <p className="c15-sr">{t("achievements.dialog.eyebrow")}</p>
      <div className="c15-card__stage">
        <C15SpinMedal item={lead} engraving={medalEngraving(lead, t, effectiveLanguage)} className="c15-medal c15-card__hero" />
      </div>
      <Story item={lead} titleId={titleId} level="single" />
    </>
  );
}

function Several({ lead, others, titleId }: { readonly lead: AchievementItem; readonly others: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  return (
    <>
      <p className="c15-sr">{t("achievements.dialog.eyebrowMany", { count: others.length + 1 })}</p>
      <div className="c15-card__lead">
        <C15Medal item={lead} className="c15-medal c15-card__hero c15-card__hero--lead" />
        <Story item={lead} titleId={titleId} level="lead" />
        <CardFact item={lead} />
      </div>
      <section className="c15-card__rows" aria-labelledby={titleId + "-also"}>
        <h3 id={titleId + "-also"} className="c15-card__rows-label">{t("achievements.dialog.alsoEarned")}</h3>
        <ol className="c15-cardrows">
          {others.map((item, index) => <CardRow key={item.definition.id} item={item} index={index} />)}
        </ol>
      </section>
    </>
  );
}

function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  return (
    <>
      <div className="c15-card__look">
        <p className="c15-card__eyebrow">{t("achievements.dialog.firstLookEyebrow")}</p>
        <h2 id={titleId} className="c15-card__title c15-card__title--look">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c15-card__condition">{t("achievements.dialog.firstLookBody")}</p>
      </div>
      <ol className="c15-cardrows c15-cardrows--look">
        {ordered.map((item, index) => <CardRow key={item.definition.id} item={item} index={index} />)}
      </ol>
    </>
  );
}

export function C15Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  return (
    <>
      {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} />
        : others.length > 0 ? <Several lead={lead} others={others} titleId={titleId} />
          : <Single lead={lead} titleId={titleId} />}
      <div className="c15-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
