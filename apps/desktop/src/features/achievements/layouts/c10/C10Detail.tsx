import { forwardRef, useState } from "react";
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
import { historyEntries, historyFor } from "../../achievementHistory";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import { C10Medal, YearStrip, shortDay } from "./c10Parts";

/** Days listed before the rest fold behind "Show all". */
const LISTED_DAYS = 5;
/** Fewer kept days than this read as an empty axis, so they show as the list alone. */
const STRIP_MIN_DAYS = 3;

type DetailProps = {
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
};

/** Every kept day newest first, the year strip, and the times older than the kept days. */
function History({ item, onOpenDay }: { readonly item: AchievementItem; readonly onOpenDay: (day: string) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const [open, setOpen] = useState(false);
  const history = historyFor(item);
  if (!history || !item.earned) return null;
  const entries = historyEntries(history);
  const listed = open ? entries : entries.slice(0, LISTED_DAYS);
  const folded = entries.length - LISTED_DAYS;
  return (
    <section className="c10-history" aria-label={t("achievements.record.title")}>
      <p className="c10-history__title">
        <span>{t("achievements.record.title")}</span>
        <span className="c10-history__count">{timesLabel(item.earned.count, t)}</span>
      </p>
      <div className="c10-history__days" data-open={open ? "true" : undefined}>
        <ol className="c10-days">
          {listed.map(({ day, ordinal }) => (
            <li key={day}>
              <button type="button" className="c10-day" data-history-day={day} title={t("achievements.openDay")} onClick={() => onOpenDay(day)}>
                <span className="c10-day__nth">{t("achievements.c10.nth", { count: ordinal })}</span>
                <span className="c10-day__date">{shortDay(day, effectiveLanguage)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      {folded > 0 || history.earlier > 0 ? (
        <p className="c10-history__foot">
          {folded > 0 ? (
            <button type="button" className="c10-link" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              {open ? t("achievements.c10.showFewer") : t("achievements.c10.showAll", { count: entries.length })}
            </button>
          ) : null}
          {history.earlier > 0 ? (
            <span className="c10-history__earlier" data-history-earlier={history.earlier}>
              <span className="c10-history__earlier-count">{t("achievements.c10.earlier", { count: history.earlier })}</span>
              <span className="c10-history__earlier-note">{t("achievements.c10.earlierNote")}</span>
            </span>
          ) : null}
        </p>
      ) : null}
      {entries.length >= STRIP_MIN_DAYS ? (
        <YearStrip entries={entries} litDay={entries[0]?.day} onOpenDay={onOpenDay} label={(count) => t("achievements.c10.lastMonths", { count })} />
      ) : null}
    </section>
  );
}

/** The chosen achievement as a band under the cabinet: medal and name, three facts, then its record. */
export const C10Detail = forwardRef<HTMLElement, DetailProps>(function C10Detail({ item, isNew, onOpenDay }, ref) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const medal = nextMedal(item);
  const progress = earned || concealed ? null : progressText(item, t, effectiveLanguage);
  const context = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) context.push(t("achievements.hiddenFound"));
  const repeated = Boolean(earned && definition.repeatable);

  return (
    <aside ref={ref} className="c10-band" data-state={earned ? "earned" : "locked"} aria-live="polite">
      <div key={definition.id} className="c10-band__inner">
        <div className="c10-band__head">
          <div className="c10-band__mark">
            <C10Medal item={item} className="c10-medal c10-band__medal" />
            {repeated && earned && earned.count > 1 ? (
              <span className="c10-band__times">{t("achievements.c10.multiplier", { count: earned.count })}</span>
            ) : null}
          </div>
          <div className="c10-band__text">
            <p className="c10-band__context">
              {context.join(" · ")}
              {isNew ? <span className="c10-band__new"><span className="c10-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
            </p>
            <h3 className="c10-band__name">{achievementName(item, t)}</h3>
            <p className="c10-band__condition">{achievementCondition(item, t)}</p>
          </div>
          {!concealed ? (
            <dl className="c10-facts">
              {earned ? (
                <div className="c10-fact">
                  <dt>{t("achievements.c10.firstEarned")}</dt>
                  <dd>
                    {repeated ? (
                      <span className="c10-fact__value">{formatAchievementDay(earned.firstDay, effectiveLanguage)}</span>
                    ) : (
                      <button type="button" className="c10-link c10-fact__day" data-history-day={earned.firstDay} title={t("achievements.openDay")} onClick={() => onOpenDay(earned.firstDay)}>
                        {formatAchievementDay(earned.firstDay, effectiveLanguage)}
                      </button>
                    )}
                  </dd>
                </div>
              ) : progress ? (
                <div className="c10-fact c10-fact--progress">
                  <dt>{t("achievements.progress")}</dt>
                  <dd>
                    <span className="c10-fact__value">{progress}</span>
                    <span className="c10-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                    <span className="c10-fact__note">{remainingText(item, t, effectiveLanguage)}</span>
                  </dd>
                </div>
              ) : (
                <div className="c10-fact">
                  <dt>{t("achievements.record.title")}</dt>
                  <dd><span className="c10-fact__value is-quiet">{t("achievements.notEarned")}</span></dd>
                </div>
              )}
              {rarity ? (
                <div className="c10-fact">
                  <dt>{t("achievements.rarity.title")}</dt>
                  <dd>
                    <span className="c10-fact__value" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</span>
                    <span className="c10-fact__note">{raritySentence(rarity, t, effectiveLanguage, "tab")}</span>
                  </dd>
                </div>
              ) : null}
              {earned ? (
                <div className="c10-fact">
                  <dt>{t("achievements.medal.title")}</dt>
                  <dd>
                    <span className="c10-fact__value">{medalName(item, t)}</span>
                    <span className="c10-fact__note">
                      {!definition.repeatable ? t("achievements.medal.once") : medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")}
                    </span>
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
        {repeated ? <History item={item} onOpenDay={onOpenDay} /> : null}
      </div>
    </aside>
  );
});
