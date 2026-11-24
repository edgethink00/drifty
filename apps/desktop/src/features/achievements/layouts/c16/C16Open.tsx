import { Fragment } from "react";
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
  timesLabel,
} from "../../achievementCopy";
import { historyFor } from "../../achievementHistory";
import { progressText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import { shortDay } from "./c16Copy";

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
      <p className="c16-open__meta">{meta.join(" · ")}</p>
      {rarity ? (
        <p className="c16-open__rarity">
          <span className="c16-open__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</span>
          {" · "}
          {raritySentence(rarity, t, effectiveLanguage, "tab")}
        </p>
      ) : null}
      {earned && history && history.days.length > 0 ? (
        <p className="c16-open__history">
          <span className="c16-open__lead">
            {definition.repeatable ? timesLabel(history.days.length + history.earlier, t) : t("achievements.stat.earnedOn")}
          </span>
          {history.days.map((day, index) => (
            <Fragment key={day}>
              {index > 0 ? " " : null}
              <span className="c16-day">
                <button
                  type="button"
                  className="c16-link"
                  data-history-day={day}
                  aria-label={t("achievements.c16.historyDay", { date: formatAchievementDay(day, effectiveLanguage) })}
                  onClick={() => onOpenDay(day)}
                >
                  {shortDay(day, effectiveLanguage)}
                </button>
                {index < history.days.length - 1 ? "," : null}
              </span>
            </Fragment>
          ))}
          {history.earlier > 0 ? (
            <span className="c16-open__earlier" data-history-earlier={history.earlier}>
              <span aria-hidden="true"> … </span>
              {history.earlier === 1 ? t("achievements.c16.earlierOne") : t("achievements.c16.earlier", { count: history.earlier })}
            </span>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
