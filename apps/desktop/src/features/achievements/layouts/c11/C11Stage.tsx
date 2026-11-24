import { forwardRef } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { GOLD_FROM_COUNT, RING_FROM_COUNT, achievementBadgeStage, achievementBadgeUrl, type AchievementBadgeStage } from "../../achievementBadge";
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
import { C11Medal, nthLabel, shortDay } from "./c11Parts";

const MEDAL_STEPS: readonly { readonly stage: AchievementBadgeStage; readonly from: number }[] = [
  { stage: "silver", from: 1 },
  { stage: "gold", from: GOLD_FROM_COUNT },
  { stage: "ring", from: RING_FROM_COUNT },
];

type StageProps = {
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
};

/** Every kept day newest first, as a timeline that scrolls inside the stage, with older times counted at its foot. */
function History({ item, onOpenDay }: Omit<StageProps, "isNew">) {
  const { effectiveLanguage, t } = useLocalization();
  const history = historyFor(item);
  if (!item.earned || !history) return null;
  const entries = historyEntries(history);
  return (
    <div className="c11-history">
      <p className="c11-zone__head">
        <span>{t("achievements.record.title")}</span>
        <span className="c11-zone__value">{timesLabel(item.earned.count, t)}</span>
      </p>
      <div className="c11-history__frame">
        <div className="c11-history__scroll">
          <ol className="c11-history__list">
            {entries.map((entry, index) => (
              <li key={entry.day} className="c11-history__entry" data-latest={index === 0 ? "true" : undefined}>
                <button
                  type="button"
                  className="c11-history__day"
                  data-history-day={entry.day}
                  title={t("achievements.openDay")}
                  onClick={() => onOpenDay(entry.day)}
                >
                  <span className="c11-history__nth">{nthLabel(entry.ordinal, t, effectiveLanguage)}</span>
                  <span className="c11-history__date">{shortDay(entry.day, effectiveLanguage)}</span>
                </button>
              </li>
            ))}
            {history.earlier > 0 ? (
              <li className="c11-history__entry c11-history__earlier" data-history-earlier={history.earlier}>
                {history.earlier === 1 ? t("achievements.c11.earlierOne") : t("achievements.c11.earlier", { count: history.earlier })}
              </li>
            ) : null}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** A locked one: how far along it is, where its days will gather once earned. */
function Progress({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const concealed = item.definition.hidden;
  const progress = concealed ? null : progressText(item, t, effectiveLanguage);
  return (
    <div className="c11-progress">
      <p className="c11-zone__head"><span>{t("achievements.progress")}</span></p>
      {progress ? (
        <>
          <p className="c11-progress__value">{progress}</p>
          <span className="c11-bar c11-progress__bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
          <p className="c11-progress__left">{remainingText(item, t, effectiveLanguage)}</p>
        </>
      ) : (
        <p className="c11-progress__none">{t(concealed ? "achievements.notEarned" : "achievements.c11.notStarted")}</p>
      )}
      <p className="c11-progress__hint">{t("achievements.c11.historyEmpty")}</p>
    </div>
  );
}

/** The chosen achievement on the stage: medal and its multiplier, what it means and holds, then its history. */
export const C11Stage = forwardRef<HTMLElement, StageProps>(function C11Stage({ item, isNew, onOpenDay }, ref) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const stage = achievementBadgeStage(item);
  const medal = nextMedal(item);
  const times = earned && definition.repeatable && earned.count > 1 ? earned.count : null;
  const context = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) context.push(t("achievements.hiddenFound"));

  return (
    <aside ref={ref} className="editorial-panel c11-stage" data-state={earned ? "earned" : "locked"} aria-live="polite">
      <div key={definition.id} className="c11-stage__inner">
        <div className="c11-stage__jewel">
          <C11Medal item={item} className="c11-medal c11-stage__medal" />
          {times ? (
            <span className="c11-stage__times" aria-hidden="true"><span className="c11-stage__x">×</span>{times}</span>
          ) : null}
        </div>

        <div className="c11-stage__text">
          <p className="c11-stage__context">
            {context.join(" · ")}
            {isNew ? <span className="c11-stage__new"><span className="c11-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
          </p>
          <h3 className="c11-stage__name">{achievementName(item, t)}</h3>
          <p className="c11-stage__condition">{achievementCondition(item, t)}</p>

          {!concealed && (rarity || earned) ? (
            <dl className="c11-facts">
              {rarity ? (
                <div className="c11-facts__row">
                  <dt>{t("achievements.rarity.title")}</dt>
                  <dd>
                    <span className="c11-facts__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</span>
                    <span className="c11-facts__note">{raritySentence(rarity, t, effectiveLanguage, "tab")}</span>
                  </dd>
                </div>
              ) : null}
              {earned ? (
                <div className="c11-facts__row">
                  <dt>{t("achievements.c11.firstEarned")}</dt>
                  <dd><span className="c11-facts__value">{formatAchievementDay(earned.firstDay, effectiveLanguage)}</span></dd>
                </div>
              ) : null}
              {earned ? (
                <div className="c11-facts__row">
                  <dt>{t("achievements.medal.title")}</dt>
                  <dd>
                    <span className="c11-track" aria-hidden="true">
                      {(definition.repeatable ? MEDAL_STEPS : MEDAL_STEPS.filter((step) => step.stage === stage)).map((step) => {
                        const src = achievementBadgeUrl(definition.id, step.stage, true);
                        return (
                          <span key={step.stage} className="c11-track__stop" data-current={step.stage === stage ? "true" : undefined} data-ahead={step.from > earned.count && definition.repeatable ? "true" : undefined}>
                            {src ? <img src={src} alt="" draggable={false} /> : null}
                          </span>
                        );
                      })}
                    </span>
                    <span className="c11-facts__value">{medalName(item, t)}</span>
                    <span className="c11-facts__note">
                      {!definition.repeatable ? t("achievements.medal.once") : medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")}
                    </span>
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>

        <div className="c11-stage__zone">
          {earned ? <History item={item} onOpenDay={onOpenDay} /> : <Progress item={item} />}
        </div>
      </div>
    </aside>
  );
});
