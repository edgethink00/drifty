import { useId, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementCondition, achievementName, formatAchievementDay, medalName, raritySentence, shownRarity } from "../../achievementCopy";
import { historyEntries, historyFor } from "../../achievementHistory";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import { C13Medal } from "./C13Medal";
import { ordinal, rowFact, rowMeta, sharePercent, shortDay } from "./c13Copy";

type RowProps = {
  readonly item: AchievementItem;
  readonly open: boolean;
  readonly fresh: boolean;
  readonly underWay?: boolean;
  readonly onToggle: () => void;
  readonly onOpenDay: (day: string) => void;
};

/**
 * Where day `index` of `count` sits when the days run down then across `cols` columns,
 * the first columns taking one extra day each so no column is more than one shorter.
 */
function balancedCell(index: number, count: number, cols: number): { readonly col: number; readonly row: number } {
  const short = Math.floor(count / cols);
  const tall = Math.ceil(count / cols);
  const tallCols = count % cols;
  const tallSpan = tallCols * tall;
  if (index < tallSpan) return { col: Math.floor(index / tall) + 1, row: (index % tall) + 1 };
  const rest = index - tallSpan;
  return { col: tallCols + Math.floor(rest / short) + 1, row: (rest % short) + 1 };
}

/** Grid placement for every column count the table uses (2 and 3 beside the story, 4 stacked under it). */
function cellStyle(index: number, count: number): CSSProperties {
  const style: Record<string, number> = {};
  for (const cols of [2, 3, 4]) {
    const { col, row } = balancedCell(index, count, cols);
    style[`--c13-col-${cols}`] = col;
    style[`--c13-row-${cols}`] = row;
  }
  return style as CSSProperties;
}

function History({ item, onOpenDay }: { readonly item: AchievementItem; readonly onOpenDay: (day: string) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const history = historyFor(item);
  if (!history || !item.earned) return null;
  const entries = historyEntries(history);
  const repeatable = item.definition.repeatable;
  const span = entries.length <= 6 ? "one" : entries.length <= 16 ? "two" : "many";
  return (
    <div className="c13-history" data-span={span}>
      <p className="c13-history__title">{t("achievements.record.title")}</p>
      <ol className="c13-history__list">
        {entries.map(({ day, ordinal: count }, index) => {
          const nth = repeatable ? ordinal(count, t, effectiveLanguage) : t("achievements.stat.earnedOn");
          return (
            <li key={day} style={cellStyle(index, entries.length)}>
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

function Facts({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const rarity = shownRarity(item);
  const metal = medalName(item, t);
  const medal = nextMedal(item);
  const repeatable = definition.repeatable && (earned?.count ?? 0) > 1;
  const day = (value: string) => formatAchievementDay(value, effectiveLanguage);
  return (
    <dl className="c13-facts">
      {earned && repeatable ? (
        <>
          <div className="c13-facts__row"><dt>{t("achievements.stat.first")}</dt><dd>{day(earned.firstDay)}</dd></div>
          <div className="c13-facts__row"><dt>{t("achievements.stat.last")}</dt><dd>{day(earned.lastDay)}</dd></div>
        </>
      ) : earned ? (
        <div className="c13-facts__row"><dt>{t("achievements.stat.earnedOn")}</dt><dd>{day(earned.firstDay)}</dd></div>
      ) : null}
      {earned && metal ? (
        <div className="c13-facts__row">
          <dt>{t("achievements.medal.title")}</dt>
          <dd>
            <span className="c13-facts__strong">{metal}</span>
            <span className="c13-facts__note">
              {!definition.repeatable ? t("achievements.medal.once") : medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")}
            </span>
            {medal ? <span className="c13-bar c13-facts__bar" aria-hidden="true"><span style={{ width: Math.round(medal.share * 100) + "%" }} /></span> : null}
          </dd>
        </div>
      ) : null}
      {rarity ? (
        <div className="c13-facts__row"><dt>{t("achievements.rarity.title")}</dt><dd>{raritySentence(rarity, t, effectiveLanguage, "tab")}</dd></div>
      ) : null}
    </dl>
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
          {fact && !open && !underWay ? <span className="c13-row__fact" data-kind={earned ? "day" : "left"}>{fact}</span> : null}
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
          <span className="c13-row__progress">
            <span className="c13-row__share" aria-hidden="true">{sharePercent(progressShare(item), effectiveLanguage)}</span>
            <span className="c13-bar c13-row__bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
            {fact ? <span className="c13-row__left">{fact}</span> : null}
          </span>
        ) : null}
        {open ? (
          <div className="c13-open">
            <p className="c13-open__meta">
              {meta.map((part) => <span key={part.key} className="c13-meta" data-tone={part.tone}>{part.text}</span>)}
              {earned && definition.hidden ? <span className="c13-meta">{t("achievements.hiddenFound")}</span> : null}
            </p>
            <Facts item={item} />
          </div>
        ) : null}
      </div>
      {open ? (earned ? <History item={item} onOpenDay={onOpenDay} /> : concealed ? null : <Progress item={item} />) : null}
    </section>
  );
}
