import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { achievementBadgeStage } from "../../achievementBadge";
import {
  achievementCondition,
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
import { C7Medal } from "./C7Medal";
import { ordinal, shortDay } from "./c7Copy";

type DetailProps = {
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
};

/** The chosen achievement beside the board: medal with its count, meaning, facts, then every kept day. */
export function C7Detail({ item, isNew, onOpenDay }: DetailProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const history = historyFor(item);
  const entries = history && definition.repeatable ? historyEntries(history) : [];
  const medal = nextMedal(item);
  const progress = earned || concealed ? null : progressText(item, t, effectiveLanguage);
  const stage = achievementBadgeStage(item);
  const context = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) context.push(t("achievements.hiddenFound"));
  const firstDay = earned?.firstDay ?? null;
  const firstDayKept = firstDay !== null && (history?.days.includes(firstDay) ?? false);

  return (
    <aside className="editorial-panel c7-detail" data-state={earned ? "earned" : "locked"} aria-live="polite">
      <div key={definition.id} className="c7-detail__inner">
        <div className="c7-detail__top">
          <span className="c7-detail__medal-box">
            <C7Medal item={item} className="c7-medal c7-detail__medal" />
            {earned && definition.repeatable && earned.count > 1 ? (
              <span className="c7-chip" data-stage={stage} aria-hidden="true">×{earned.count}</span>
            ) : null}
          </span>
          <p className="c7-detail__context">
            {context.join(" · ")}
            {isNew ? <span className="c7-detail__new"><span className="c7-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
          </p>
          <h3 className="c7-detail__name">{achievementName(item, t)}</h3>
          <p className="c7-detail__condition">{achievementCondition(item, t)}</p>
        </div>

        {!concealed ? (
          <dl className="c7-facts">
            {rarity ? (
              <div className="c7-facts__row">
                <dt>{t("achievements.rarity.title")}</dt>
                <dd>
                  <span className="c7-facts__value" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</span>
                  <span className="c7-facts__note">{raritySentence(rarity, t, effectiveLanguage, "tab")}</span>
                </dd>
              </div>
            ) : null}
            {earned && firstDay ? (
              <div className="c7-facts__row">
                <dt>{t("achievements.c7.firstDay")}</dt>
                <dd>
                  {firstDayKept && !definition.repeatable ? (
                    <button
                      type="button"
                      className="c7-link c7-facts__value"
                      data-history-day={firstDay}
                      aria-label={t("achievements.c7.historyDay", { nth: ordinal(1, t, effectiveLanguage), date: formatAchievementDay(firstDay, effectiveLanguage) })}
                      onClick={() => onOpenDay(firstDay)}
                    >
                      {formatAchievementDay(firstDay, effectiveLanguage)}
                    </button>
                  ) : (
                    <span className="c7-facts__value">{formatAchievementDay(firstDay, effectiveLanguage)}</span>
                  )}
                </dd>
              </div>
            ) : null}
            {earned && definition.repeatable ? (
              <div className="c7-facts__row">
                <dt>{t("achievements.medal.title")}</dt>
                <dd>
                  <span className="c7-facts__value">{medalName(item, t)}</span>
                  <span className="c7-facts__note">{medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")}</span>
                </dd>
              </div>
            ) : null}
            {!earned ? (
              <div className="c7-facts__row">
                <dt>{t("achievements.progress")}</dt>
                <dd>
                  {progress ? (
                    <>
                      <span className="c7-facts__value">{progress}</span>
                      <span className="c7-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                      <span className="c7-facts__note">{remainingText(item, t, effectiveLanguage)}</span>
                    </>
                  ) : (
                    <span className="c7-facts__value is-quiet">{t("achievements.notEarned")}</span>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {entries.length > 0 && history ? (
          <section className="c7-history" aria-labelledby={"c7-history-" + definition.id}>
            <h4 id={"c7-history-" + definition.id} className="c7-history__title">{t("achievements.record.title")}</h4>
            <ol className="c7-history__list">
              {entries.map(({ day, ordinal: count }) => {
                const nth = ordinal(count, t, effectiveLanguage);
                return (
                  <li key={day}>
                    <button
                      type="button"
                      className="c7-history__day"
                      data-history-day={day}
                      aria-label={t("achievements.c7.historyDay", { nth, date: formatAchievementDay(day, effectiveLanguage) })}
                      onClick={() => onOpenDay(day)}
                    >
                      <span className="c7-history__nth">{nth}</span>
                      <span className="c7-history__date">{shortDay(day, effectiveLanguage)}</span>
                    </button>
                  </li>
                );
              })}
              {history.earlier > 0 ? (
                <li className="c7-history__earlier" data-history-earlier={history.earlier}>
                  {history.earlier === 1 ? t("achievements.c7.earlierOne") : t("achievements.c7.earlier", { count: history.earlier })}
                </li>
              ) : null}
            </ol>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
