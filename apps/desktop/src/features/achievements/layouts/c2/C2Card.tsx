import type { CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { AchievementMedal } from "../../AchievementMedal";
import {
  achievementCondition,
  achievementName,
  formatAchievementDay,
  medalName,
  raritySentence,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C2Plinth, C2Rarity, C2Status, earnedRecord } from "./c2Parts";
import "./c2-parts.css";
import "./c2-card.css";

const OTHERS_SHOWN = 4;

function byFirstDay(left: AchievementItem, right: AchievementItem): number {
  return (left.earned?.firstDay ?? "").localeCompare(right.earned?.firstDay ?? "") || right.definition.weight - left.definition.weight;
}

function rarestOf(items: readonly AchievementItem[]): AchievementItem | undefined {
  return items
    .filter((item) => shownRarity(item) !== null)
    .sort((left, right) => (left.rarity?.percent ?? 100) - (right.rarity?.percent ?? 100) || right.definition.weight - left.definition.weight)[0];
}

function Actions({ onClose, onView, closeLabel, viewLabel }: { readonly onClose: () => void; readonly onView: () => void; readonly closeLabel: string; readonly viewLabel: string }) {
  return (
    <div className="c2-card__actions">
      <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{closeLabel}</button>
      <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{viewLabel}</button>
    </div>
  );
}

export function C2Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const actions = <Actions onClose={onClose} onView={onView} closeLabel={t("achievements.dialog.close")} viewLabel={t("achievements.dialog.view")} />;
  const leadHasRarity = shownRarity(lead) !== null;

  if (showFirstLook) {
    const found = [...ordered].sort(byFirstDay);
    const rarest = rarestOf(ordered);
    const rarestRarity = rarest ? shownRarity(rarest) : null;
    return (
      <div className="c2-card c2-card--journal">
        <div className="c2-card__head">
          <p className="c2-card__context">{t("achievements.dialog.firstLookEyebrow")}</p>
          <h2 id={titleId} className="c2-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
          <p className="c2-card__body">{t("achievements.dialog.firstLookBody")}</p>
        </div>
        <ol className="c2-journal" style={{ "--c2-journal-rows": Math.ceil(found.length / 2) } as CSSProperties}>
          {found.map((item, index) => {
            const meta = [medalName(item, t), item.definition.repeatable && item.earned && item.earned.count > 1 ? timesLabel(item.earned.count, t) : null].filter(Boolean).join(" · ");
            return (
              <li key={item.definition.id} className="c2-journal__entry" style={{ animationDelay: 160 + index * 45 + "ms" }}>
                <span className="c2-journal__date">{item.earned ? formatAchievementDay(item.earned.firstDay, effectiveLanguage) : ""}</span>
                <AchievementMedal item={item} />
                <span className="c2-journal__text">
                  <span className="c2-journal__name">{achievementName(item, t)}</span>
                  <span className="c2-journal__meta">{meta}</span>
                </span>
              </li>
            );
          })}
        </ol>
        {rarest && rarestRarity ? (
          <p className="c2-card__rarest">
            <span className="c2-card__rarest-lead">{t("achievements.dialog.rarest", { name: achievementName(rarest, t) })}</span>
            <span> · {raritySentence(rarestRarity, t, effectiveLanguage, "tab")}</span>
          </p>
        ) : null}
        {actions}
      </div>
    );
  }

  if (others.length === 0) {
    return (
      <div className="c2-card c2-card--single">
        <div className="c2-card__stage"><C2Plinth item={lead} size="hero" arrive /></div>
        <div className="c2-card__story">
          <p className="c2-card__context">{t("achievements.dialog.eyebrow")}</p>
          <h2 id={titleId} className="c2-card__title">{achievementName(lead, t)}</h2>
          <p className="c2-card__condition">{achievementCondition(lead, t)}</p>
        </div>
        <div className="c2-line" data-rarity={leadHasRarity ? "shown" : "none"}>
          <span className="c2-line__cell">
            <span className="c2-line__caption">{t(("achievements.group." + lead.definition.group) as TranslationKey)}</span>
            <C2Status item={lead} t={t} language={effectiveLanguage} />
          </span>
          {leadHasRarity ? (
            <span className="c2-line__cell c2-line__cell--rarity">
              <span className="c2-line__caption">{t("achievements.c2.rarityHead")}</span>
              <C2Rarity item={lead} t={t} language={effectiveLanguage} />
            </span>
          ) : null}
        </div>
        {actions}
      </div>
    );
  }

  const shown = others.slice(0, OTHERS_SHOWN);
  return (
    <div className="c2-card c2-card--several">
      <p className="c2-card__context">{t("achievements.dialog.eyebrowMany", { count: ordered.length })}</p>
      <div className="c2-lead">
        <C2Plinth item={lead} size="lead" arrive />
        <div className="c2-lead__story">
          <h2 id={titleId} className="c2-card__title">{achievementName(lead, t)}</h2>
          <p className="c2-card__condition">{achievementCondition(lead, t)}</p>
          <div className="c2-lead__line">
            <C2Status item={lead} t={t} language={effectiveLanguage} />
            {leadHasRarity ? <C2Rarity item={lead} t={t} language={effectiveLanguage} /> : null}
          </div>
        </div>
      </div>
      <p className="c2-card__also">{t("achievements.dialog.alsoEarned")}</p>
      <ul className="c2-mini">
        {shown.map((item, index) => (
          <li key={item.definition.id} className="c2-mini__row" style={{ animationDelay: 420 + index * 50 + "ms" }}>
            <AchievementMedal item={item} />
            <span className="c2-mini__text">
              <span className="c2-mini__name">{achievementName(item, t)}</span>
              <span className="c2-mini__meta">{[earnedRecord(item, t, effectiveLanguage), medalName(item, t)].filter(Boolean).join(" · ")}</span>
            </span>
            <C2Rarity item={item} t={t} language={effectiveLanguage} />
          </li>
        ))}
      </ul>
      {others.length > OTHERS_SHOWN ? <p className="c2-card__more">{t("achievements.dialog.more", { count: others.length - OTHERS_SHOWN })}</p> : null}
      {actions}
    </div>
  );
}
