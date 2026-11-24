import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
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
import { historyFor } from "../../achievementHistory";
import { progressText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import { historyMonths } from "./c16Copy";

type OpenProps = {
  readonly item: AchievementItem;
  readonly id: string;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
};

/** An opened row: plain lines under the name, the record as a line of dates that each open their day. */
export function C16Open({ item, id, isNew, onOpenDay }: OpenProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const headingId = id + "-name";
  const rarity = shownRarity(item);
  const history = historyFor(item);
  const progress = earned ? null : progressText(item, t, effectiveLanguage);

  const meta = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned) {
    const medal = medalName(item, t);
    if (medal) meta.push(medal);
    if (definition.hidden) meta.push(t("achievements.hiddenFound"));
    if (isNew) meta.push(t("achievements.newArrival"));
  } else if (progress) {
    meta.push(t("achievements.progress") + " " + progress);
  }

  return (
    <section id={id} className="c16-open" aria-labelledby={headingId}>
      <h3 id={headingId} className="c16-sr">{achievementName(item, t)}</h3>
      <p className="c16-open__condition">{achievementCondition(item, t)}</p>
      <p className="c16-open__meta">
        <span className="c16-open__parts">
          <span className="c16-open__part">{meta.join(" · ")}</span>
          {rarity ? (
            <span className="c16-open__part" data-part="rarity">
              <span className="c16-open__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</span>
              {" · "}
              {raritySentence(rarity, t, effectiveLanguage, "tab")}
            </span>
          ) : null}
        </span>
      </p>
      {earned && history && history.days.length > 0 ? (
        <div className="c16-open__history">
          <ul className="c16-months">
            {historyMonths(history.days, effectiveLanguage).map((month) => (
              <li key={month.key} className="c16-month">
                <span className="c16-month__label">{month.label}</span>
                <span className="c16-month__days">
                  {month.days.map((day, index) => (
                    <span key={day} className="c16-month__day">
                      <button
                        type="button"
                        className="c16-link"
                        data-history-day={day}
                        aria-label={t("achievements.c16.historyDay", { date: formatAchievementDay(day, effectiveLanguage) })}
                        onClick={() => onOpenDay(day)}
                      >
                        {Number(day.slice(8, 10))}
                      </button>
                      {index < month.days.length - 1 ? <span className="c16-month__sep" aria-hidden="true">·</span> : null}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {history.earlier > 0 ? (
            <p className="c16-open__earlier" data-history-earlier={history.earlier}>
              {history.earlier === 1 ? t("achievements.c16.earlierOne") : t("achievements.c16.earlier", { count: history.earlier })}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
