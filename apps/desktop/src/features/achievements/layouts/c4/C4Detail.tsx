import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { GOLD_FROM_COUNT, RING_FROM_COUNT, achievementBadgeStage, achievementBadgeUrl, type AchievementBadgeStage } from "../../achievementBadge";
import {
  achievementCondition,
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
import { achievementMilestoneProgress } from "../../achievementMilestones";
import { progressShare, progressText, remainingText } from "../../achievementProgress";
import { formatRarityBasis } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";
import { entryDay, medalSource, nextLine } from "./c4Journal";

const MEDAL_STEPS: readonly { readonly stage: AchievementBadgeStage; readonly from: number; readonly label: TranslationKey }[] = [
  { stage: "silver", from: 1, label: "achievements.medal.silver" },
  { stage: "gold", from: GOLD_FROM_COUNT, label: "achievements.medal.gold" },
  { stage: "ring", from: RING_FROM_COUNT, label: "achievements.medal.ringShort" },
];

type DetailProps = {
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
};

/** The chosen achievement: its medal and name, then the medal steps, the record, progress and rarity. */
export function C4Detail({ item, isNew, onOpenDay }: DetailProps) {
  const { effectiveLanguage: language, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const progress = earned ? null : progressText(item, t, language);
  const src = medalSource(item, false);
  const current = achievementBadgeStage(item);
  const next = nextLine(item, t);
  const milestone = earned && definition.repeatable && !next ? achievementMilestoneProgress(earned.count) : null;
  const context = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) context.push(t("achievements.hiddenFound"));
  if (!earned && !concealed) context.push(t("achievements.notEarned"));

  return (
    <aside className="c4-detail" data-state={earned ? "earned" : "locked"} aria-live="polite">
      <div className="c4-detail__head">
        <span key={definition.id} className="c4-detail__medal">
          {src ? <img className="c4-medal-img" src={src} alt="" draggable={false} /> : null}
        </span>
        <div className="c4-detail__title">
          <p className="c4-detail__context">
            {context.join(" · ")}
            {isNew ? <span className="c4-detail__new"><span className="c4-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
          </p>
          <h3 className="c4-detail__name">{achievementName(item, t)}</h3>
          <p className="c4-detail__condition">{achievementCondition(item, t)}</p>
        </div>
      </div>

      {!concealed && (earned || progress || rarity) ? (
        <dl className="c4-facts">
          {earned && definition.repeatable ? (
            <div className="c4-facts__row">
              <dt>{t("achievements.medal.title")}</dt>
              <dd>
                <ol className="c4-steps">
                  {MEDAL_STEPS.map((step) => {
                    const stepSrc = achievementBadgeUrl(definition.id, step.stage, true);
                    const isCurrent = step.stage === current;
                    return (
                      <li key={step.stage} className="c4-steps__stop" data-current={isCurrent ? "true" : undefined} aria-current={isCurrent ? "step" : undefined}>
                        {stepSrc ? <img className="c4-steps__medal" src={stepSrc} alt="" draggable={false} /> : null}
                        <span className="c4-steps__name">{t(step.label)}</span>
                        <span className="c4-steps__from">{isCurrent ? t("achievements.medal.now", { count: earned.count }) : t("achievements.medal.from", { count: step.from })}</span>
                      </li>
                    );
                  })}
                </ol>
                <p className="c4-facts__note">
                  {next ?? t("achievements.medal.top")}
                  {milestone ? <span className="c4-facts__quiet"> · {t("achievements.milestone.next", { target: milestone.target })}</span> : null}
                </p>
              </dd>
            </div>
          ) : null}

          {earned ? (
            <div className="c4-facts__row">
              <dt>{t("achievements.record.title")}</dt>
              <dd>
                <p className="c4-facts__value">
                  {definition.repeatable && earned.count > 1 ? (
                    <>
                      <span className="c4-facts__chunk">{timesLabel(earned.count, t)}</span>
                      <span className="c4-facts__chunk">{t("achievements.stat.first")} {formatAchievementDay(earned.firstDay, language)}</span>
                      <span className="c4-facts__chunk">{t("achievements.stat.last")} {formatAchievementDay(earned.lastDay, language)}</span>
                    </>
                  ) : (
                    <>
                      <span className="c4-facts__chunk">{t("achievements.dialog.earnedOn", { date: formatAchievementDay(entryDay(item), language) })}</span>
                      {!definition.repeatable ? <span className="c4-facts__chunk">{medalName(item, t)} · {t("achievements.medal.once")}</span> : null}
                    </>
                  )}
                </p>
                <button type="button" className="app-btn app-btn--secondary app-btn--compact c4-facts__action" onClick={() => onOpenDay(entryDay(item))}>
                  {t("achievements.openDay")}
                </button>
              </dd>
            </div>
          ) : progress ? (
            <div className="c4-facts__row">
              <dt>{t("achievements.progress")}</dt>
              <dd>
                <span className="c4-progress c4-progress--detail">
                  <span className="c4-progress__bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                </span>
                <p className="c4-facts__value">
                  <span className="c4-facts__chunk">{progress}</span>
                  <span className="c4-facts__chunk c4-facts__strong">{remainingText(item, t, language)}</span>
                </p>
              </dd>
            </div>
          ) : null}

          {rarity ? (
            <div className="c4-facts__row">
              <dt>{t("achievements.rarity.title")}</dt>
              <dd>
                <p className="c4-facts__value">
                  <span className="c4-facts__chunk">{raritySentence(rarity, t, language, "tab")}</span>
                  <strong className="c4-facts__chunk c4-facts__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</strong>
                </p>
                <p className="c4-facts__quiet">
                  {rarityReadsAsFew(rarity)
                    ? t("achievements.rarity.basisShort")
                    : t("achievements.rarity.basis", { count: formatRarityBasis(rarity.basisCount, language) })}
                </p>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </aside>
  );
}
