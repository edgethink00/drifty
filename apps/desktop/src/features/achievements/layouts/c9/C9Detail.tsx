import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import {
  achievementCondition,
  achievementName,
  formatAchievementDay,
  medalName,
  raritySentence,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { historyEntries, historyFor } from "../../achievementHistory";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import { C9Medal } from "./C9Parts";
import { shortDay } from "./c9Copy";

/** About two rows of chips at the widest; the rest wait behind "Show all". */
const CHIP_LIMIT = 12;

type DetailProps = {
  readonly id: string;
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
  /** Escape inside the record closes it and hands focus back to its row. */
  readonly onClose: () => void;
};

function History({ item, onOpenDay }: { readonly item: AchievementItem; readonly onOpenDay: (day: string) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const [all, setAll] = useState(false);
  const history = historyFor(item);
  if (!history) return null;
  const entries = historyEntries(history);
  const shown = all ? entries : entries.slice(0, CHIP_LIMIT);
  return (
    <div className="c9-history">
      <p className="c9-history__title">
        <span>{t("achievements.record.title")}</span>
        <span className="c9-history__count">{timesLabel(entries.length + history.earlier, t)}</span>
      </p>
      <ul className="c9-chips">
        {shown.map(({ day, ordinal }) => {
          const nth = t("achievements.c9.nth", { count: ordinal });
          return (
            <li key={day}>
              <button
                type="button"
                className="c9-chip"
                data-history-day={day}
                aria-label={t("achievements.c9.dayLabel", { nth, date: formatAchievementDay(day, effectiveLanguage) })}
                onClick={() => onOpenDay(day)}
              >
                <span className="c9-chip__nth">{nth}</span>
                <span className="c9-chip__day">{shortDay(day, effectiveLanguage)}</span>
              </button>
            </li>
          );
        })}
        {entries.length > CHIP_LIMIT ? (
          <li>
            <button type="button" className="c9-chip c9-chip--toggle" aria-expanded={all} onClick={() => setAll((value) => !value)}>
              {all ? t("achievements.c9.showLess") : t("achievements.c9.showAll", { count: entries.length })}
            </button>
          </li>
        ) : null}
        {history.earlier > 0 ? (
          <li className="c9-chip c9-chip--earlier" data-history-earlier={history.earlier}>
            {t("achievements.c9.earlier", { count: history.earlier })}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** The chosen row's record, opened in place under it. */
export function C9Detail({ id, item, isNew, onOpenDay, onClose }: DetailProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const medal = nextMedal(item);
  const progress = earned || concealed ? null : progressText(item, t, effectiveLanguage);
  const titleId = id + "-title";

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  }

  return (
    <aside id={id} className="c9-detail" data-state={earned ? "earned" : "locked"} aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className="c9-detail__mark">
        <C9Medal item={item} className="c9-medal c9-detail__medal" />
        {earned && definition.repeatable ? (
          <span className="c9-detail__times">{t("achievements.c9.times", { count: earned.count })}</span>
        ) : null}
      </div>
      <div className="c9-detail__body">
        <h3 id={titleId} className="c9-detail__name">
          {achievementName(item, t)}
          {isNew ? <span className="c9-detail__new"><span className="c9-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
        </h3>
        <p className="c9-detail__condition">{achievementCondition(item, t)}</p>
        {rarity ? <p className="c9-detail__rarity">{raritySentence(rarity, t, effectiveLanguage, "tab")}</p> : null}

        {earned ? (
          <dl className="c9-facts">
            <div className="c9-facts__item">
              <dt>{t("achievements.c9.firstDay")}</dt>
              <dd>{formatAchievementDay(earned.firstDay, effectiveLanguage)}</dd>
            </div>
            <div className="c9-facts__item">
              <dt>{t("achievements.medal.title")}</dt>
              <dd>
                {medalName(item, t)}
                <span className="c9-facts__note">
                  {!definition.repeatable ? t("achievements.medal.once") : medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")}
                </span>
              </dd>
            </div>
          </dl>
        ) : progress ? (
          <div className="c9-progress-block">
            <p className="c9-progress-block__text">
              <span>{progress}</span>
              <span className="c9-progress-block__left">{remainingText(item, t, effectiveLanguage)}</span>
            </p>
            <span className="c9-bar" aria-hidden="true"><span style={{ "--c9-share": progressShare(item) } as CSSProperties} /></span>
          </div>
        ) : !concealed ? (
          <p className="c9-detail__quiet">{t("achievements.notEarned")}</p>
        ) : null}

        {earned ? <History key={definition.id} item={item} onOpenDay={onOpenDay} /> : null}
      </div>
    </aside>
  );
}
