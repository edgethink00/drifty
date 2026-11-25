import { useId } from "react";
import { ModalCloseButton } from "../../../../components/ModalCloseButton";
import { formatLocalizedCompactDurationFromSeconds, localeForDisplayLanguage } from "../../../../lib/formatting";
import { useModalDismiss } from "../../../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../../../lib/useOverlayDismiss";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { achievementBadgeUrl, type AchievementBadgeStage } from "../../achievementBadge";
import { achievementCondition, achievementName, formatAchievementDay, raritySentence, shownRarity, timesLabel } from "../../achievementCopy";
import type { AchievementDayFacts } from "../../achievementFacts";
import { dayMeasure, dayMeasureKind, type DayMeasureKind } from "../../achievementDayMeasure";
import { progressShare, progressText, remainingText } from "../../achievementProgress";
import { formatRarityPercent } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";
import { C15SpinMedal } from "./C15Medal";

type PopupProps = {
  readonly item: AchievementItem;
  /** Where the medal sits: beside the title, or large above it. */
  readonly look?: "side" | "stage";
  readonly onClose: () => void;
  readonly onOpenDay: (day: string) => void;
};

/** "2026년 9월 28일": the full day for the medal's back, with its year. */
function engravedDay(day: string, language: DisplayLanguage): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), { year: "numeric", month: "long", day: "numeric" }).format(new Date(year, month - 1, date, 12));
}

const FIGURE_KEYS: Readonly<Record<Exclude<DayMeasureKind, "drift">, TranslationKey>> = {
  run: "achievements.c15.pop.figure.run",
  focus: "achievements.c15.pop.figure.focus",
  early: "achievements.c15.pop.figure.early",
  late: "achievements.c15.pop.figure.late",
  noDrift: "achievements.c15.pop.figure.noDrift",
};

/** "2h 4m unbroken focus": the figure a measured kind reached. */
function figureFor(kind: DayMeasureKind, value: number, t: Translate, language: DisplayLanguage): string {
  if (kind === "drift") return t("achievements.c15.pop.figure.drift", { percent: Math.round(value * 100) });
  return t(FIGURE_KEYS[kind], { duration: formatLocalizedCompactDurationFromSeconds(value, language) });
}

function dayFigure(item: AchievementItem, facts: AchievementDayFacts | undefined, t: Translate, language: DisplayLanguage): string | null {
  const kind = dayMeasureKind(item.definition.id);
  return kind && facts ? figureFor(kind, dayMeasure(kind, facts), t, language) : null;
}

/**
 * An achievement's own page, opened from its row: the big medal and what it
 * asks and the record: first and latest day (with what the latest reached) and
 * how many times. The metal is left to the medal itself; nothing names it. Everything here is new
 * beyond the row, which already shows the name, condition, count and share.
 */
export function C15Popup({ item, look = "side", onClose, onOpenDay }: PopupProps) {
  const { effectiveLanguage, t } = useLocalization();
  const titleId = useId();
  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const latestDay = earned ? (definition.repeatable ? earned.lastDay : earned.firstDay) : "";
  const latestFigure = earned ? dayFigure(item, item.historyFacts?.[latestDay], t, effectiveLanguage) : null;
  const kind = dayMeasureKind(definition.id);
  const best = !earned && item.best && kind ? item.best : null;
  const progress = !earned && !concealed ? progressText(item, t, effectiveLanguage) : null;
  const open = (day: string) => { onClose(); onOpenDay(day); };
  const share = rarity ? t("achievements.rarity.detail", { percent: formatRarityPercent(rarity.percent, effectiveLanguage) }) : null;
  const few = rarity ? raritySentence(rarity, t, effectiveLanguage, "tab") : null;
  const previewStage: AchievementBadgeStage = definition.repeatable || definition.weight < 5 ? "silver" : "gold";
  const preview = !earned && !concealed ? achievementBadgeUrl(definition.id, previewStage, true) : undefined;
  const engraving = earned ? [achievementName(item, t), engravedDay(earned.firstDay, effectiveLanguage)] : [];

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        className="auth-modal modal-shell c15-pop"
        data-modal-variant="standard"
        data-state={earned ? "earned" : "locked"}
        data-look={look}
        lang={effectiveLanguage}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("achievements.dialog.close")} onClick={onClose} />
        <header className="c15-pop__head">
          <C15SpinMedal item={item} engraving={engraving} className="c15-medal c15-pop__medal" />
          <div className="c15-pop__title">
            {concealed ? null : <p className="c15-pop__group">{t(("achievements.group." + definition.group) as TranslationKey)}</p>}
            <h2 id={titleId} className="c15-pop__name">{achievementName(item, t)}</h2>
            <p className="c15-pop__condition">{achievementCondition(item, t)}</p>
            {share ? <p className="c15-pop__share">{few && few !== share ? few : share}</p> : null}
          </div>
        </header>

        {!earned && !concealed && (progress || (best && kind) || preview) ? (
          <section className="c15-pop__part" aria-labelledby="c15-pop-toearn">
            <h3 id="c15-pop-toearn" className="c15-pop__label">{t("achievements.c15.pop.toEarn")}</h3>
            {progress ? (
              <div className="c15-pop__progress">
                <span className="c15-pop__progress-text">{progress}</span>
                <span className="c15-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                <span className="c15-pop__note">{remainingText(item, t, effectiveLanguage)}</span>
              </div>
            ) : null}
            {best && kind ? (
              <p className="c15-pop__best">
                <button type="button" className="c15-pop__link" onClick={() => open(best.day)}>
                  {t("achievements.c15.pop.best", { date: formatAchievementDay(best.day, effectiveLanguage), figure: figureFor(kind, best.value, t, effectiveLanguage) })}
                </button>
              </p>
            ) : null}
            {preview ? (
              <p className="c15-pop__preview">
                <span className="c15-pop__preview-medal" aria-hidden="true"><img src={preview} alt="" draggable={false} /></span>
                {t("achievements.c15.pop.preview")}
              </p>
            ) : null}
          </section>
        ) : null}

        {earned ? (
          <section className="c15-pop__part" aria-labelledby="c15-pop-record">
            <h3 id="c15-pop-record" className="c15-pop__label">{t("achievements.record.title")}</h3>
            <dl className="c15-pop__facts">
              {definition.repeatable ? (
                <div className="c15-pop__fact">
                  <dt>{t("achievements.stat.first")}</dt>
                  <dd><span className="c15-pop__fact-value">{formatAchievementDay(earned.firstDay, effectiveLanguage)}</span></dd>
                </div>
              ) : null}
              <div className="c15-pop__fact">
                <dt>{t(definition.repeatable ? "achievements.stat.last" : "achievements.stat.earnedOn")}</dt>
                <dd>
                  <button type="button" className="c15-pop__fact-value c15-pop__link" data-history-day={latestDay} onClick={() => open(latestDay)}>
                    {formatAchievementDay(latestDay, effectiveLanguage)}
                  </button>
                  {latestFigure ? <span className="c15-pop__fact-note">{latestFigure}</span> : null}
                </dd>
              </div>
              {definition.repeatable ? (
                <div className="c15-pop__fact">
                  <dt>{t("achievements.c15.pop.times")}</dt>
                  <dd><span className="c15-pop__fact-value">{timesLabel(earned.count, t)}</span></dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}
      </section>
    </div>
  );
}
