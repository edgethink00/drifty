import { useLocalization } from "../../../localization/LocalizationContext";
import {
  achievementName,
  formatAchievementDay,
  medalName,
  rarityIsNotable,
  raritySentence,
  rarityTierName,
  shownRarity,
} from "../../achievementCopy";
import { historyEntries, historyFor } from "../../achievementHistory";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import { C12Medal } from "./C12Medal";
import { groupLabel, ordinal, shortDay } from "./c12Copy";

type OpenedProps = {
  readonly id: string;
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
};

/** The opened row, directly under it in the list: meaning, medal, rarity, first day, then every kept day as a chip. */
export function C12Opened({ id, item, isNew, onOpenDay }: OpenedProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const history = historyFor(item);
  const entries = history && definition.repeatable ? historyEntries(history) : [];
  const medal = nextMedal(item);
  const progress = earned || concealed ? null : progressText(item, t, effectiveLanguage);
  const headingId = id + "-name";
  const firstDay = earned?.firstDay ?? null;
  const firstDayKept = firstDay !== null && (history?.days.includes(firstDay) ?? false);
  const foundHidden = Boolean(earned && definition.hidden);

  return (
    <section id={id} className="c12-open" data-state={earned ? "earned" : "locked"} aria-labelledby={headingId}>
      <div className="c12-open__body">
        <h3 id={headingId} className="c12-sr">{achievementName(item, t)}</h3>
        <div className="c12-open__lead">
        <C12Medal item={item} className="c12-medal c12-open__medal" />
        <div className="c12-open__facts">
        {isNew || foundHidden ? (
          <p className="c12-open__note">
            {isNew ? <span className="c12-open__new"><span className="c12-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
            {foundHidden ? <span>{t("achievements.hiddenFound")}</span> : null}
          </p>
        ) : null}

        {!concealed ? (
          <dl className="c12-facts">
            {earned ? (
              <div className="c12-fact">
                <dt>{t("achievements.medal.title")}</dt>
                <dd>
                  <span className="c12-fact__value">{medalName(item, t)}</span>
                  {medal ? (
                    <span className="c12-bar c12-bar--stage" aria-hidden="true"><span style={{ width: Math.round(medal.share * 100) + "%" }} /></span>
                  ) : null}
                  <span className="c12-fact__note">
                    {!definition.repeatable ? t("achievements.medal.once") : medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")}
                  </span>
                </dd>
              </div>
            ) : (
              <div className="c12-fact c12-fact--wide">
                <dt>{t("achievements.progress")}</dt>
                <dd>
                  {progress ? (
                    <>
                      <span className="c12-fact__value">{progress}</span>
                      <span className="c12-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                      <span className="c12-fact__note">{remainingText(item, t, effectiveLanguage)}</span>
                    </>
                  ) : (
                    <span className="c12-fact__value is-quiet">{t("achievements.notEarned")}</span>
                  )}
                </dd>
              </div>
            )}
            {rarity ? (
              <div className="c12-fact c12-fact--wide">
                <dt>{t("achievements.rarity.title")}</dt>
                <dd>
                  <span className="c12-fact__value" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</span>
                  <span className="c12-fact__note">{raritySentence(rarity, t, effectiveLanguage, "tab")}</span>
                </dd>
              </div>
            ) : null}
            {earned && firstDay ? (
              <div className="c12-fact">
                <dt>{t("achievements.c12.firstDay")}</dt>
                <dd>
                  {firstDayKept && !definition.repeatable ? (
                    <button
                      type="button"
                      className="c12-link c12-fact__value"
                      data-history-day={firstDay}
                      aria-label={t("achievements.c12.historyDay", { nth: ordinal(1, t, effectiveLanguage), date: formatAchievementDay(firstDay, effectiveLanguage) })}
                      onClick={() => onOpenDay(firstDay)}
                    >
                      {formatAchievementDay(firstDay, effectiveLanguage)}
                    </button>
                  ) : (
                    <span className="c12-fact__value">{formatAchievementDay(firstDay, effectiveLanguage)}</span>
                  )}
                </dd>
              </div>
            ) : null}
            <div className="c12-fact">
              <dt>{t("achievements.c12.topic")}</dt>
              <dd><span className="c12-fact__value">{groupLabel(definition.group, t)}</span></dd>
            </div>
          </dl>
        ) : null}
        </div>
        </div>

        {entries.length > 0 && history ? (
          <div className="c12-history">
            <h4 id={id + "-record"} className="c12-history__title">{t("achievements.record.title")}</h4>
            <ol className="c12-history__list" aria-labelledby={id + "-record"}>
              {entries.map(({ day, ordinal: count }) => {
                const nth = ordinal(count, t, effectiveLanguage);
                return (
                  <li key={day}>
                    <button
                      type="button"
                      className="c12-day"
                      data-history-day={day}
                      aria-label={t("achievements.c12.historyDay", { nth, date: formatAchievementDay(day, effectiveLanguage) })}
                      onClick={() => onOpenDay(day)}
                    >
                      <span className="c12-day__nth">{nth}</span>
                      <span className="c12-day__date">{shortDay(day, effectiveLanguage)}</span>
                    </button>
                  </li>
                );
              })}
              {history.earlier > 0 ? (
                <li className="c12-history__earlier" data-history-earlier={history.earlier}>
                  {history.earlier === 1 ? t("achievements.c12.earlierOne") : t("achievements.c12.earlier", { count: history.earlier })}
                </li>
              ) : null}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}
