import { Fragment } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { GOLD_FROM_COUNT, RING_FROM_COUNT, achievementBadgeStage, achievementBadgeUrl, type AchievementBadgeStage } from "../../achievementBadge";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  formatAchievementDay,
  medalName,
  rarityIsNotable,
  rarityReadsAsFew,
  raritySentence,
  rarityTierName,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { AchievementMedal } from "../../AchievementMedal";
import { achievementMilestoneProgress } from "../../achievementMilestones";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import { formatRarityBasis } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";

const MEDAL_STEPS: readonly { readonly stage: AchievementBadgeStage; readonly from: number; readonly label: TranslationKey }[] = [
  { stage: "silver", from: 1, label: "achievements.medal.silver" },
  { stage: "gold", from: GOLD_FROM_COUNT, label: "achievements.medal.gold" },
  { stage: "ring", from: RING_FROM_COUNT, label: "achievements.medal.ringShort" },
];

function MedalSteps({ item, count, t }: { readonly item: AchievementItem; readonly count: number; readonly t: Translate }) {
  const current = achievementBadgeStage(item);
  return (
    <div className="c3-track">
      {MEDAL_STEPS.map((step, index) => {
        const previous = MEDAL_STEPS[index - 1];
        const share = previous ? Math.max(0, Math.min(1, (count - previous.from) / (step.from - previous.from))) : 0;
        const isCurrent = step.stage === current;
        const src = achievementBadgeUrl(item.definition.id, step.stage, true);
        return (
          <Fragment key={step.stage}>
            {previous ? <span className="c3-track__line" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span> : null}
            <span className={"c3-track__stop" + (isCurrent ? " is-current" : "")} aria-current={isCurrent ? "step" : undefined}>
              {src ? <img className="c3-track__medal" src={src} alt="" draggable={false} /> : null}
              <span>{t(step.label)}</span>
              <span className="c3-track__note">{isCurrent ? t("achievements.medal.now", { count }) : t("achievements.medal.from", { count: step.from })}</span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

type C3PageProps = {
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
};

/** The right-hand page: the chosen medal large, then what it asks, how far it has come and how rare it is. */
export function C3Page({ item, isNew, onOpenDay }: C3PageProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const medal = nextMedal(item);
  const milestone = earned && definition.repeatable ? achievementMilestoneProgress(earned.count) : null;
  const progress = earned ? null : progressText(item, t, effectiveLanguage);
  const context = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) context.push(t("achievements.hiddenFound"));
  if (!earned && !concealed) context.push(t("achievements.notEarned"));

  return (
    <aside className="c3-page" data-state={earned ? "earned" : "locked"} aria-live="polite">
      <div key={definition.id} className="c3-page__inner">
        <div className="c3-page__medal"><AchievementMedal item={item} size="xl" /></div>
        <p className="c3-page__context">
          <span>{context.join(" · ")}</span>
          {isNew ? <span className="c3-page__new"><span className="c3-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
        </p>
        <h3 className="c3-page__name">{achievementName(item, t)}</h3>
        <p className="c3-page__condition">{achievementCondition(item, t)}</p>

        {!concealed && (earned || progress || rarity) ? (
          <dl className="c3-facts">
            {earned && definition.repeatable ? (
              <div className="c3-fact">
                <dt>{t("achievements.medal.title")}</dt>
                <dd>
                  <MedalSteps item={item} count={earned.count} t={t} />
                  <span className="c3-fact__strong">{medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")}</span>
                  {milestone && !medal ? <span className="c3-fact__quiet">{t("achievements.milestone.next", { target: milestone.target })}</span> : null}
                </dd>
              </div>
            ) : null}

            {earned ? (
              <div className="c3-fact">
                <dt>{t("achievements.record.title")}</dt>
                <dd className="c3-stats">
                  {definition.repeatable && earned.count > 1 ? (
                    <>
                      <span className="c3-stats__item"><span>{t("achievements.stat.first")}</span><strong>{formatAchievementDay(earned.firstDay, effectiveLanguage)}</strong></span>
                      <span className="c3-stats__item"><span>{t("achievements.stat.last")}</span><strong>{formatAchievementDay(earned.lastDay, effectiveLanguage)}</strong></span>
                      <span className="c3-stats__item"><span>{t("achievements.stat.count")}</span><strong>{timesLabel(earned.count, t)}</strong></span>
                    </>
                  ) : (
                    <span className="c3-stats__item"><span>{t("achievements.stat.earnedOn")}</span><strong>{formatAchievementDay(achievementDay(item) ?? earned.firstDay, effectiveLanguage)}</strong></span>
                  )}
                  {!definition.repeatable ? (
                    <span className="c3-stats__item"><span>{t("achievements.medal.title")}</span><strong>{medalName(item, t)}</strong></span>
                  ) : null}
                </dd>
              </div>
            ) : progress ? (
              <div className="c3-fact">
                <dt>{t("achievements.progress")}</dt>
                <dd className="c3-page__progress">
                  <span className="c3-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                  <span className="c3-page__progress-line">
                    <span>{progress}</span>
                    <strong>{remainingText(item, t, effectiveLanguage)}</strong>
                  </span>
                </dd>
              </div>
            ) : null}

            {rarity ? (
              <div className="c3-fact">
                <dt>{t("achievements.rarity.title")}</dt>
                <dd className="c3-rarity">
                  <strong className="c3-rarity__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</strong>
                  <span className="c3-rarity__sentence">{raritySentence(rarity, t, effectiveLanguage, "tab")}</span>
                  <span className="c3-rarity__note">
                    {rarityReadsAsFew(rarity)
                      ? t("achievements.rarity.basisShort")
                      : t("achievements.rarity.basis", { count: formatRarityBasis(rarity.basisCount, effectiveLanguage) })}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {earned ? (
          <button type="button" className="app-btn app-btn--secondary app-btn--compact c3-page__action" onClick={() => onOpenDay(achievementDay(item) ?? earned.firstDay)}>
            {t("achievements.openDay")}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
