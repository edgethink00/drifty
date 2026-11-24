import { forwardRef } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import {
  achievementCondition,
  achievementName,
  formatAchievementDay,
  medalName,
  raritySentence,
  rarityTierName,
  shownRarity,
} from "../../achievementCopy";
import { historyEntries, historyFor } from "../../achievementHistory";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import { C8Medal, Multiplier } from "./c8Parts";

type SheetProps = {
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly titleId: string;
  readonly onOpenDay: (day: string) => void;
  readonly onClose: () => void;
};

function Record({ item, onOpenDay }: { readonly item: AchievementItem; readonly onOpenDay: (day: string) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const history = historyFor(item);
  if (!earned || !history) {
    const progress = definition.hidden ? null : progressText(item, t, effectiveLanguage);
    if (!progress) return <p className="c8-record__quiet">{t("achievements.notEarned")}</p>;
    return (
      <div className="c8-record__progress">
        <p className="c8-record__line">
          <span>{t("achievements.progress")}</span>
          <span className="c8-record__value">{progress}</span>
        </p>
        <span className="c8-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
        <p className="c8-record__quiet">{remainingText(item, t, effectiveLanguage)}</p>
      </div>
    );
  }
  const entries = historyEntries(history);
  const repeated = definition.repeatable;
  return (
    <>
      {repeated ? <p className="c8-record__line">{t("achievements.c8.firstDay", { date: formatAchievementDay(earned.firstDay, effectiveLanguage) })}</p> : null}
      <ol className="c8-timeline">
        {entries.map(({ day, ordinal }, index) => (
          <li key={day} className="c8-timeline__item" data-latest={index === 0 ? "true" : undefined}>
            <button type="button" className="c8-timeline__day" data-history-day={day} title={t("achievements.openDay")} onClick={() => onOpenDay(day)}>
              <span className="c8-timeline__dot" aria-hidden="true" />
              <span className="c8-timeline__nth">{repeated ? t("achievements.c8.nth", { count: ordinal }) : t("achievements.stat.earnedOn")}</span>
              <span className="c8-timeline__date">{formatAchievementDay(day, effectiveLanguage)}</span>
              <svg className="c8-timeline__go" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
            </button>
          </li>
        ))}
        {history.earlier > 0 ? (
          <li className="c8-timeline__item c8-timeline__item--earlier" data-history-earlier={history.earlier}>
            <span className="c8-timeline__dot" aria-hidden="true" />
            <span className="c8-timeline__earlier">
              <span className="c8-timeline__nth">{history.earlier === 1 ? t("achievements.c8.earlierOne") : t("achievements.c8.earlier", { count: history.earlier })}</span>
              <span className="c8-timeline__note">{t("achievements.c8.earlierNote")}</span>
            </span>
          </li>
        ) : null}
      </ol>
    </>
  );
}

/** The chosen achievement's record sheet, laid over the tab: medal stage, meaning, then every kept day. */
export const C8Sheet = forwardRef<HTMLButtonElement, SheetProps>(function C8Sheet({ item, isNew, titleId, onOpenDay, onClose }, closeRef) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const rarity = shownRarity(item);
  const medal = earned ? medalName(item, t) : null;
  const next = nextMedal(item);
  const context = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) context.push(t("achievements.hiddenFound"));
  if (isNew) context.push(t("achievements.newArrival"));

  return (
    <aside className="c8-sheet" data-state={earned ? "earned" : "locked"} aria-labelledby={titleId}>
      <button ref={closeRef} type="button" className="c8-sheet__close" aria-label={t("achievements.dialog.close")} onClick={onClose}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
      <div key={definition.id} className="c8-sheet__scroll">
        <div className="c8-stage" data-stage={earned ? "earned" : "locked"}>
          <C8Medal item={item} className="c8-medal c8-sheet__medal" />
        </div>
        <div className="c8-sheet__body">
          <p className="c8-sheet__context">{context.join(" · ")}</p>
          <div className="c8-sheet__title">
            <h3 id={titleId} className="c8-sheet__name">{achievementName(item, t)}</h3>
            <Multiplier item={item} t={t} className="c8-x c8-x--title" />
          </div>
          <p className="c8-sheet__meaning">{achievementCondition(item, t)}</p>
          {medal ? (
            <p className="c8-sheet__medal-line">
              {[medal, definition.repeatable ? (next ? t(next.key, { remaining: next.remaining }) : t("achievements.medal.top")) : null].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {rarity ? (
            <p className="c8-sheet__rarity">
              <span className="c8-sheet__tier">{rarityTierName(item, rarity, t)}</span>
              <span>{raritySentence(rarity, t, effectiveLanguage, "tab")}</span>
            </p>
          ) : null}
          <section className="c8-record" aria-labelledby={titleId + "-record"}>
            <h4 id={titleId + "-record"} className="c8-record__title">{t("achievements.record.title")}</h4>
            <Record item={item} onOpenDay={onOpenDay} />
          </section>
        </div>
      </div>
    </aside>
  );
});
