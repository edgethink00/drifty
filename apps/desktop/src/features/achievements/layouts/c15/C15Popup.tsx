import { useId, useMemo, type CSSProperties } from "react";
import { shiftIsoDate } from "@drifty/domain";
import { ModalCloseButton } from "../../../../components/ModalCloseButton";
import { formatLocalizedCompactDurationFromSeconds, localeForDisplayLanguage } from "../../../../lib/formatting";
import { useModalDismiss } from "../../../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../../../lib/useOverlayDismiss";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { achievementBadgeStage, achievementBadgeUrl, GOLD_FROM_COUNT, RING_FROM_COUNT, type AchievementBadgeStage } from "../../achievementBadge";
import { achievementCondition, achievementName, formatAchievementDay, raritySentence, shownRarity } from "../../achievementCopy";
import type { AchievementDayFacts } from "../../achievementFacts";
import { dayMeasure, dayMeasureKind, type DayMeasureKind } from "../../achievementDayMeasure";
import { historyEntries, historyFor } from "../../achievementHistory";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import { formatRarityPercent } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";
import { C15Medal } from "./C15Medal";
import { ordinal } from "./c15Copy";

type PopupProps = {
  readonly item: AchievementItem;
  readonly onClose: () => void;
  readonly onOpenDay: (day: string) => void;
};

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

const MEDAL_KEYS: Readonly<Record<"silver" | "gold" | "ring", TranslationKey>> = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.medal.ringShort",
};

const LADDER: readonly (readonly ["silver" | "gold" | "ring", number])[] = [["silver", 1], ["gold", GOLD_FROM_COUNT], ["ring", RING_FROM_COUNT]];

/** The three metals of a repeatable medal, as the real images: reached ones and the next one to come. */
function MedalLadder({ item }: { readonly item: AchievementItem }) {
  const { t } = useLocalization();
  const count = item.earned?.count ?? 0;
  const stage = item.earned ? achievementBadgeStage(item) : null;
  const next = nextMedal(item);
  return (
    <section className="c15-pop__part" aria-labelledby="c15-pop-medals">
      <h3 id="c15-pop-medals" className="c15-pop__label">{t("achievements.c15.pop.medals")}</h3>
      <ol className="c15-pop__ladder">
        {LADDER.map(([metal, at]) => {
          const src = achievementBadgeUrl(item.definition.id, metal as AchievementBadgeStage, true);
          return (
            <li key={metal} className="c15-pop__rung" data-reached={count >= at ? "true" : undefined} data-current={stage === metal ? "true" : undefined}>
              <span className="c15-pop__rung-medal" aria-hidden="true">{src ? <img src={src} alt="" draggable={false} /> : null}</span>
              <span className="c15-pop__rung-name">{t(MEDAL_KEYS[metal])}</span>
              <span className="c15-pop__rung-at">{t("achievements.c15.pop.medalAt", { count: at })}</span>
            </li>
          );
        })}
      </ol>
      {next ? <p className="c15-pop__note">{t(next.key, { remaining: next.remaining })}</p> : null}
    </section>
  );
}

const CALENDAR_WEEKS = 26;

/** Monday-first weeks ending this week, with the earned days marked; each mark opens its day. */
function EarnedCalendar({ days, onOpenDay }: { readonly days: readonly string[]; readonly onOpenDay: (day: string) => void }) {
  const { effectiveLanguage } = useLocalization();
  const earned = useMemo(() => new Set(days), [days]);
  const cells = useMemo(() => {
    const now = new Date();
    const today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    const weekday = (now.getDay() + 6) % 7;
    const start = shiftIsoDate(today, -(weekday + (CALENDAR_WEEKS - 1) * 7));
    return Array.from({ length: CALENDAR_WEEKS * 7 }, (_, index) => {
      const day = shiftIsoDate(start, index);
      return { day, future: day > today };
    });
  }, []);
  const months = useMemo(() => {
    const labels: { column: number; label: string }[] = [];
    let last = "";
    cells.forEach(({ day }, index) => {
      if (index % 7 !== 0) return;
      const month = day.slice(0, 7);
      if (month === last) return;
      last = month;
      const [year, monthNumber] = month.split("-").map(Number);
      labels.push({ column: index / 7, label: new Intl.DateTimeFormat(localeForDisplayLanguage(effectiveLanguage), { month: "short" }).format(new Date(year, monthNumber - 1, 15)) });
    });
    return labels.filter((entry, index) => index > 0 || entry.column === 0);
  }, [cells, effectiveLanguage]);
  return (
    <div className="c15-cal" style={{ "--c15-cal-weeks": CALENDAR_WEEKS } as CSSProperties}>
      <div className="c15-cal__months" aria-hidden="true">
        {months.map(({ column, label }) => <span key={column} style={{ gridColumn: column + 1 }}>{label}</span>)}
      </div>
      <div className="c15-cal__grid">
        {cells.map(({ day, future }) => (
          earned.has(day) ? (
            <button
              key={day}
              type="button"
              className="c15-cal__cell is-earned"
              data-history-day={day}
              aria-label={formatAchievementDay(day, effectiveLanguage)}
              title={formatAchievementDay(day, effectiveLanguage)}
              onClick={() => onOpenDay(day)}
            />
          ) : <span key={day} className={"c15-cal__cell" + (future ? " is-future" : "")} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}

const RECENT_DAYS = 5;

/**
 * An achievement's own page, opened from its row: the big medal and what it
 * asks, the three metals as real medals, when it was earned on a half-year
 * calendar, and what each recent day actually reached. Everything here is new
 * beyond the row, which already shows the name, condition, count and share.
 */
export function C15Popup({ item, onClose, onOpenDay }: PopupProps) {
  const { effectiveLanguage, t } = useLocalization();
  const titleId = useId();
  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const history = earned ? historyFor(item) : null;
  const entries = history ? historyEntries(history) : [];
  const recent = entries.slice(0, RECENT_DAYS);
  const more = entries.length - recent.length + (history?.earlier ?? 0);
  const kind = dayMeasureKind(definition.id);
  const best = !earned && item.best && kind ? item.best : null;
  const progress = !earned && !concealed ? progressText(item, t, effectiveLanguage) : null;
  const open = (day: string) => { onClose(); onOpenDay(day); };
  const share = rarity ? t("achievements.rarity.detail", { percent: formatRarityPercent(rarity.percent, effectiveLanguage) }) : null;
  const few = rarity ? raritySentence(rarity, t, effectiveLanguage, "tab") : null;
  const previewStage: AchievementBadgeStage = definition.repeatable || definition.weight < 5 ? "silver" : "gold";
  const preview = !earned && !concealed && !definition.repeatable ? achievementBadgeUrl(definition.id, previewStage, true) : undefined;

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        className="auth-modal modal-shell c15-pop"
        data-modal-variant="standard"
        data-state={earned ? "earned" : "locked"}
        lang={effectiveLanguage}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("achievements.dialog.close")} onClick={onClose} />
        <header className="c15-pop__head">
          <C15Medal item={item} className="c15-medal c15-pop__medal" />
          <div className="c15-pop__title">
            {concealed ? null : <p className="c15-pop__group">{t(("achievements.group." + definition.group) as TranslationKey)}</p>}
            <h2 id={titleId} className="c15-pop__name">{achievementName(item, t)}</h2>
            <p className="c15-pop__condition">{achievementCondition(item, t)}</p>
            {share ? <p className="c15-pop__share">{few && few !== share ? few : share}</p> : null}
          </div>
        </header>

        {definition.repeatable && !concealed ? <MedalLadder item={item} /> : null}

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

        {earned && history && entries.length > 0 ? (
          <section className="c15-pop__part" aria-labelledby="c15-pop-days">
            <h3 id="c15-pop-days" className="c15-pop__label">{t("achievements.c15.pop.days")}</h3>
            {definition.repeatable ? <EarnedCalendar days={history.days} onOpenDay={open} /> : null}
            <ol className="c15-pop__days">
              {recent.map(({ day, ordinal: count }) => {
                const date = formatAchievementDay(day, effectiveLanguage);
                const figure = dayFigure(item, item.historyFacts?.[day], t, effectiveLanguage);
                return (
                  <li key={day}>
                    <button
                      type="button"
                      className="c15-pop__day"
                      data-history-day={day}
                      aria-label={t("achievements.c15.historyDay", { nth: ordinal(count, t, effectiveLanguage), date })}
                      onClick={() => open(day)}
                    >
                      <span className="c15-pop__day-date">{date}</span>
                      {definition.repeatable ? <span className="c15-pop__day-nth">{ordinal(count, t, effectiveLanguage)}</span> : null}
                      <span className="c15-pop__day-figure">{figure}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {more > 0 ? (
              <p className="c15-pop__note" data-history-earlier={history.earlier || undefined}>
                {more === 1 ? t("achievements.c15.earlierOne") : t("achievements.c15.earlier", { count: more })}
              </p>
            ) : null}
          </section>
        ) : null}
      </section>
    </div>
  );
}
