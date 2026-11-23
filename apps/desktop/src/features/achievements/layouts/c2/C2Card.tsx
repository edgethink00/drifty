import type { CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { DisplayLanguage } from "../../../localization/languagePreference";
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
import { C2Detail } from "./C2Detail";
import { C2Rarity, C2Status, Chevron } from "./c2Parts";
import "./c2-parts.css";
import "./c2-tab.css";
import "./c2-card.css";

type Translate = ReturnType<typeof useLocalization>["t"];

const ROWS_SHOWN = 4;

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

/* The tab's list row, drawn as a still header: the lead is open, the rest closed. */
function CardRow({ item, titleId, open, t, language }: { readonly item: AchievementItem; readonly titleId?: string; readonly open: boolean; readonly t: Translate; readonly language: DisplayLanguage }) {
  const name = achievementName(item, t);
  return (
    <div className={open ? "c2-row" : "c2-row c2-row--compact"} data-state="earned" data-open={open ? "true" : undefined}>
      <span className="c2-row__medal"><AchievementMedal item={item} /></span>
      <div className="c2-row__text">
        <div className="c2-row__title">
          {titleId ? <h2 id={titleId} className="c2-row__name">{name}</h2> : <span className="c2-row__name">{name}</span>}
          {open ? <span className="c2-row__new"><span className="c2-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
        </div>
        {open ? <span className="c2-row__condition">{achievementCondition(item, t)}</span> : null}
      </div>
      <span className="c2-row__facts">
        <C2Status item={item} t={t} language={language} />
        {shownRarity(item) ? <C2Rarity item={item} t={t} language={language} /> : null}
      </span>
      <Chevron />
    </div>
  );
}

export function C2Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const actions = <Actions onClose={onClose} onView={onView} closeLabel={t("achievements.dialog.close")} viewLabel={t("achievements.dialog.view")} />;

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

  const companions = others.slice(0, ROWS_SHOWN - 1);
  const hidden = others.length - companions.length;
  const context = others.length === 0
    ? [t("achievements.dialog.eyebrow"), lead.earned ? t("achievements.c2.fromDay", { day: formatAchievementDay(lead.earned.lastDay, effectiveLanguage) }) : null].filter(Boolean).join(" \u00b7 ")
    : t("achievements.dialog.eyebrowMany", { count: ordered.length });
  return (
    <div className={others.length === 0 ? "c2-card c2-card--row" : "c2-card c2-card--row c2-card--rows"}>
      <p className="c2-card__context">{context}</p>
      <div className="c2-frame c2-card__rows" data-rarity={ordered.some((item) => shownRarity(item)) ? "shown" : "none"}>
        <div className="c2-card__lead">
          <CardRow item={lead} titleId={titleId} open t={t} language={effectiveLanguage} />
          <C2Detail item={lead} id={titleId + "-detail"} labelledBy={titleId} />
        </div>
        {companions.map((item, index) => (
          <div key={item.definition.id} className="c2-card__companion" style={{ animationDelay: 420 + index * 50 + "ms" }}>
            <CardRow item={item} open={false} t={t} language={effectiveLanguage} />
          </div>
        ))}
      </div>
      {hidden > 0 ? <p className="c2-card__more">{t("achievements.dialog.more", { count: hidden })}</p> : null}
      {actions}
    </div>
  );
}
