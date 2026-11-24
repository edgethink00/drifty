import { useId } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementCondition, achievementName, formatAchievementDay, medalName, raritySentence, shownRarity, timesLabel } from "../../achievementCopy";
import { historyEntries, historyFor } from "../../achievementHistory";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import { C13Medal } from "./C13Medal";
import { ordinal, rowFact, rowMeta, shortDay } from "./c13Copy";

type RowProps = {
  readonly item: AchievementItem;
  readonly open: boolean;
  readonly fresh: boolean;
  readonly underWay?: boolean;
  readonly onToggle: () => void;
  readonly onOpenDay: (day: string) => void;
};

function History({ item, onOpenDay }: { readonly item: AchievementItem; readonly onOpenDay: (day: string) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const history = historyFor(item);
  if (!history || !item.earned) return null;
  const entries = historyEntries(history);
  const total = history.days.length + history.earlier;
  const repeatable = item.definition.repeatable;
  return (
    <div className="c13-history">
      <p className="c13-history__title">
        {t("achievements.record.title")}
        {repeatable ? <span className="c13-history__total">{timesLabel(total, t)}</span> : null}
      </p>
      <ol className="c13-history__list">
        {entries.map(({ day, ordinal: count }) => {
          const nth = repeatable ? ordinal(count, t, effectiveLanguage) : t("achievements.stat.earnedOn");
          return (
            <li key={day}>
              <button
                type="button"
                className="c13-history__day"
                data-history-day={day}
                aria-label={t("achievements.c13.historyDay", { nth, date: formatAchievementDay(day, effectiveLanguage) })}
                onClick={() => onOpenDay(day)}
              >
                <span className="c13-history__nth">{nth}</span>
                <span className="c13-history__date">{shortDay(day, effectiveLanguage)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {history.earlier > 0 ? (
        <p className="c13-history__earlier" data-history-earlier={history.earlier}>
          {history.earlier === 1 ? t("achievements.c13.earlierOne") : t("achievements.c13.earlier", { count: history.earlier })}
        </p>
      ) : null}
    </div>
  );
}

function Progress({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const progress = item.definition.hidden ? null : progressText(item, t, effectiveLanguage);
  return (
    <div className="c13-history c13-history--progress">
      <p className="c13-history__title">{t("achievements.progress")}</p>
      {progress ? (
        <>
          <p className="c13-progress__value">{progress}</p>
          <span className="c13-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
          <p className="c13-history__earlier">{remainingText(item, t, effectiveLanguage)}</p>
        </>
      ) : (
        <p className="c13-progress__value is-quiet">{t("achievements.notEarned")}</p>
      )}
    </div>
  );
}

/** One achievement as a two-line row; opened, it grows in place into a labelled section with its record on the right. */
export function C13Row({ item, open, fresh, underWay = false, onToggle, onOpenDay }: RowProps) {
  const { effectiveLanguage, t } = useLocalization();
  const nameId = useId();
  const { definition, earned } = item;
  const name = achievementName(item, t);
  const fact = rowFact(item, t, effectiveLanguage);
  const meta = rowMeta(item, t, effectiveLanguage, { fresh });
  const rarity = shownRarity(item);
  const medal = nextMedal(item);
  const metal = medalName(item, t);
  const concealed = definition.hidden && !earned;

  return (
    <section
      className="c13-row"
      data-state={earned ? "earned" : "locked"}
      data-open={open ? "true" : undefined}
      aria-labelledby={open ? nameId : undefined}
    >
      <button
        type="button"
        className="c13-row__hit"
        aria-expanded={open}
        aria-label={t(earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
        onClick={onToggle}
      />
      <C13Medal key={open ? "open" : "row"} item={item} className="c13-medal c13-row__medal" />
      <div className="c13-row__main">
        <div className="c13-row__line1">
          {open
            ? <h3 id={nameId} className="c13-row__name">{fresh ? <span className="c13-dot" aria-hidden="true" /> : null}{name}</h3>
            : <span className="c13-row__name">{fresh ? <span className="c13-dot" aria-hidden="true" /> : null}{name}</span>}
          {fact && !open ? <span className="c13-row__fact" data-kind={earned ? "day" : "left"}>{fact}</span> : null}
        </div>
        <p className="c13-row__line2">
          <span className="c13-row__condition">{achievementCondition(item, t)}</span>
          {meta.length > 0 && !open ? (
            <span className="c13-row__meta">
              {meta.map((part) => <span key={part.key} className="c13-meta" data-tone={part.tone}>{part.text}</span>)}
            </span>
          ) : null}
        </p>
        {underWay && !open ? (
          <span className="c13-bar c13-row__bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
        ) : null}
        {open ? (
          <div className="c13-open">
            <p className="c13-open__meta">
              {meta.map((part) => <span key={part.key} className="c13-meta" data-tone={part.tone}>{part.text}</span>)}
              {earned && definition.hidden ? <span className="c13-meta">{t("achievements.hiddenFound")}</span> : null}
            </p>
            {earned && metal ? (
              <p className="c13-open__line">
                <span className="c13-open__strong">{metal}</span>
                {definition.repeatable ? <span>{medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")}</span> : null}
              </p>
            ) : null}
            {rarity ? <p className="c13-open__line c13-open__rarity">{raritySentence(rarity, t, effectiveLanguage, "tab")}</p> : null}
          </div>
        ) : null}
      </div>
      {open ? (earned ? <History item={item} onOpenDay={onOpenDay} /> : concealed ? null : <Progress item={item} />) : null}
    </section>
  );
}
