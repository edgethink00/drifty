import { Fragment, type Ref } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import type { AchievementItem } from "../../useAchievements";
import { formatRarityBasis } from "../../achievementRarity";
import { achievementMilestoneProgress } from "../../achievementMilestones";
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
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import { SpotlightShowcase } from "./SpotlightShowcase";

const MEDAL_TRACK: readonly { readonly stage: AchievementBadgeStage; readonly from: number; readonly label: TranslationKey }[] = [
  { stage: "silver", from: 1, label: "achievements.medal.silver" },
  { stage: "gold", from: GOLD_FROM_COUNT, label: "achievements.medal.gold" },
  { stage: "ring", from: RING_FROM_COUNT, label: "achievements.medal.ringShort" },
];

function MedalTrack({ item, count, t }: { readonly item: AchievementItem; readonly count: number; readonly t: Translate }) {
  const current = achievementBadgeStage(item);
  return (
    <div className="achievement-track">
      {MEDAL_TRACK.map((step, index) => {
        const previous = MEDAL_TRACK[index - 1];
        const share = previous ? Math.max(0, Math.min(1, (count - previous.from) / (step.from - previous.from))) : 0;
        const isCurrent = step.stage === current;
        const src = achievementBadgeUrl(item.definition.id, step.stage, true);
        return (
          <Fragment key={step.stage}>
            {previous ? (
              <span className="achievement-track__line" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span>
            ) : null}
            <span className={"achievement-track__stop" + (isCurrent ? " is-current" : "")} aria-current={isCurrent ? "step" : undefined}>
              {src ? <img className="achievement-track__medal" src={src} alt="" draggable={false} /> : null}
              <span className="achievement-track__name">{t(step.label)}</span>
              <span className="achievement-track__note">{isCurrent ? t("achievements.medal.now", { count }) : t("achievements.medal.from", { count: step.from })}</span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

type StageProps = {
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
  readonly stageRef: Ref<HTMLElement>;
};

export function SpotlightStage({ item, isNew, onOpenDay, stageRef }: StageProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const medal = nextMedal(item);
  const milestone = earned && definition.repeatable ? achievementMilestoneProgress(earned.count) : null;
  const showMilestone = milestone !== null && medal === null;
  const progress = earned ? null : progressText(item, t, effectiveLanguage);
  const context = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) context.push(t("achievements.hiddenFound"));
  if (!earned && !concealed) context.push(t("achievements.notEarned"));

  return (
    <aside ref={stageRef} className="achievement-stage" data-state={earned ? "earned" : "locked"} aria-live="polite">
      <div className="achievement-stage__medal">
        <SpotlightShowcase key={definition.id} item={item} size="detail" />
      </div>
      <div className="achievement-stage__story">
        <div className="achievement-stage__head">
          <div className="achievement-stage__title">
            <p className="achievement-stage__context">
              {context.join(" · ")}
              {isNew ? <><span aria-hidden="true"> · </span><span className="achievement-stage__new"><span className="achievement-tile__dot" aria-hidden="true" />{t("achievements.newArrival")}</span></> : null}
            </p>
            <h3 className="achievement-stage__name">{achievementName(item, t)}</h3>
            <p className="achievement-stage__condition">{achievementCondition(item, t)}</p>
          </div>
        </div>

        {!concealed && (earned || progress || rarity) ? (
          <dl className="achievement-facts">
            {earned && definition.repeatable ? (
              <div className="achievement-facts__row">
                <dt>{t("achievements.medal.title")}</dt>
                <dd>
                  <MedalTrack item={item} count={earned.count} t={t} />
                </dd>
                <dd className="achievement-facts__aside">
                  <strong>{medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")}</strong>
                  {showMilestone ? <span className="achievement-facts__quiet">{t("achievements.milestone.next", { target: milestone.target })}</span> : null}
                </dd>
              </div>
            ) : null}

            {earned ? (
              <div className="achievement-facts__row">
                <dt>{t("achievements.record.title")}</dt>
                <dd className="achievement-stats">
                  {definition.repeatable && earned.count > 1 ? (
                    <>
                      <span className="achievement-stats__item"><span>{t("achievements.stat.first")}</span><strong>{formatAchievementDay(earned.firstDay, effectiveLanguage)}</strong></span>
                      <span className="achievement-stats__item"><span>{t("achievements.stat.last")}</span><strong>{formatAchievementDay(earned.lastDay, effectiveLanguage)}</strong></span>
                      <span className="achievement-stats__item"><span>{t("achievements.stat.count")}</span><strong>{timesLabel(earned.count, t)}</strong></span>
                    </>
                  ) : (
                    <span className="achievement-stats__item"><span>{t("achievements.stat.earnedOn")}</span><strong>{formatAchievementDay(achievementDay(item) ?? earned.firstDay, effectiveLanguage)}</strong></span>
                  )}
                  {!definition.repeatable ? (
                    <span className="achievement-stats__item">
                      <span>{t("achievements.medal.title")}</span>
                      <strong>{medalName(item, t)}</strong>
                      <span className="achievement-stats__note">{t("achievements.medal.once")}</span>
                    </span>
                  ) : null}
                </dd>
                <dd className="achievement-facts__aside">
                  <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => onOpenDay(achievementDay(item) ?? earned.firstDay)}>
                    {t("achievements.openDay")}
                  </button>
                </dd>
              </div>
            ) : progress ? (
              <div className="achievement-facts__row">
                <dt>{t("achievements.progress")}</dt>
                <dd className="achievement-progress">
                  <span className="achievement-progress__bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                  <span className="achievement-progress__text">{progress}</span>
                </dd>
                <dd className="achievement-facts__aside"><strong>{remainingText(item, t, effectiveLanguage)}</strong></dd>
              </div>
            ) : null}

            {rarity ? (
              <div className="achievement-facts__row">
                <dt>{t("achievements.rarity.title")}</dt>
                <dd className="achievement-rarity">
                  <span className="achievement-rarity__line">
                    {raritySentence(rarity, t, effectiveLanguage, "tab")}
                    <span className="achievement-rarity__sep" aria-hidden="true"> · </span>
                    <strong className="achievement-rarity__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</strong>
                  </span>
                  <span className="achievement-rarity__note">
                    {rarityReadsAsFew(rarity)
                      ? t("achievements.rarity.basisShort")
                      : t("achievements.rarity.basis", { count: formatRarityBasis(rarity.basisCount, effectiveLanguage) })}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </aside>
  );
}
