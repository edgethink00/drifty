import { Fragment } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { GOLD_FROM_COUNT, RING_FROM_COUNT, achievementBadgeStage, type AchievementBadgeStage } from "../../achievementBadge";
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
import { formatRarityBasis } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";
import { asEarnedForReview } from "../../useAchievementsTab";
import { C5Medal } from "./C5Medal";

const TRACK: readonly { readonly stage: AchievementBadgeStage; readonly from: number; readonly label: TranslationKey }[] = [
  { stage: "silver", from: 1, label: "achievements.medal.silver" },
  { stage: "gold", from: GOLD_FROM_COUNT, label: "achievements.medal.gold" },
  { stage: "ring", from: RING_FROM_COUNT, label: "achievements.medal.ringShort" },
];

/** Silver, gold and the double rim of a repeatable achievement; the reached one is marked. */
function MedalTrack({ item, t }: { readonly item: AchievementItem; readonly t: Translate }) {
  const count = item.earned?.count ?? 0;
  const current = item.earned ? achievementBadgeStage(item) : null;
  return (
    <div className="c5-track">
      {TRACK.map((step, index) => {
        const previous = TRACK[index - 1];
        const share = previous ? Math.max(0, Math.min(1, (count - previous.from) / (step.from - previous.from))) : 0;
        const isCurrent = step.stage === current;
        return (
          <Fragment key={step.stage}>
            {previous ? <span className="c5-track__line" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span> : null}
            <span className={"c5-track__stop" + (isCurrent ? " is-current" : "")} aria-current={isCurrent ? "step" : undefined}>
              <C5Medal item={item} stage={step.stage} small />
              <span className="c5-track__name">{t(step.label)}</span>
              <span className="c5-track__note">{isCurrent ? t("achievements.medal.now", { count }) : t("achievements.medal.from", { count: step.from })}</span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** A one-off achievement has one medal; a locked one shows the medal it will give. */
function SingleMedal({ item, t }: { readonly item: AchievementItem; readonly t: Translate }) {
  const earnedLook = asEarnedForReview(item);
  return (
    <div className="c5-track">
      <span className={"c5-track__stop c5-track__stop--inline" + (item.earned ? " is-current" : "")}>
        <C5Medal item={item} stage={achievementBadgeStage(earnedLook)} small />
        <span className="c5-track__words">
          <span className="c5-track__name">{medalName(earnedLook, t)}</span>
          <span className="c5-track__note">{t("achievements.medal.once")}</span>
        </span>
      </span>
    </div>
  );
}

type C5RailProps = {
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
};

/** The label rail under the board: the chosen achievement, what it asks, its medals and rarity. */
export function C5Rail({ item, isNew, onOpenDay }: C5RailProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const next = nextMedal(item);
  const progress = earned ? null : progressText(item, t, effectiveLanguage);
  const context = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) context.push(t("achievements.hiddenFound"));
  if (!earned && !concealed) context.push(t("achievements.notEarned"));
  const showMedals = !concealed;

  return (
    <aside className="c5-rail" data-state={earned ? "earned" : "locked"} data-facts={showMedals || rarity ? "true" : undefined} aria-live="polite">
      <div key={definition.id} className="c5-rail__body">
        <div className="c5-rail__main">
          <div className="c5-rail__medal">
            <C5Medal item={item} />
          </div>

          <div className="c5-rail__story">
            <p className="c5-rail__context">
              {context.join(" · ")}
              {isNew ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="c5-rail__new"><span className="c5-dot" aria-hidden="true" />{t("achievements.newArrival")}</span>
                </>
              ) : null}
            </p>
            <h3 className="c5-rail__name">{achievementName(item, t)}</h3>
            <p className="c5-rail__condition">{achievementCondition(item, t)}</p>

            {earned ? (
              <div className="c5-rail__record">
                <p className="c5-rail__record-text">
                  {definition.repeatable && earned.count > 1 ? (
                    <>
                      <span>{t("achievements.stat.first")} <strong>{formatAchievementDay(earned.firstDay, effectiveLanguage)}</strong></span>
                      <span className="c5-sep" aria-hidden="true">·</span>
                      <span>{t("achievements.stat.last")} <strong>{formatAchievementDay(earned.lastDay, effectiveLanguage)}</strong></span>
                      <span className="c5-sep" aria-hidden="true">·</span>
                      <strong>{timesLabel(earned.count, t)}</strong>
                    </>
                  ) : (
                    <span>{t("achievements.dialog.earnedOn", { date: formatAchievementDay(achievementDay(item) ?? earned.firstDay, effectiveLanguage) })}</span>
                  )}
                </p>
                <button type="button" className="app-btn app-btn--secondary app-btn--compact c5-rail__day" onClick={() => onOpenDay(achievementDay(item) ?? earned.firstDay)}>
                  {t("achievements.openDay")}
                </button>
              </div>
            ) : progress ? (
              <div className="c5-rail__record">
                <span className="c5-bar c5-bar--rail" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                <p className="c5-rail__record-text">
                  <span>{t("achievements.progress")} <strong>{progress}</strong></span>
                  <span className="c5-sep" aria-hidden="true">·</span>
                  <span>{remainingText(item, t, effectiveLanguage)}</span>
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {showMedals || rarity ? (
          <dl className="c5-rail__facts">
            {showMedals ? (
              <div className="c5-rail__fact">
                <dt>{earned ? t("achievements.medal.title") : t("achievements.c5.medalsAhead")}</dt>
                <dd>
                  {definition.repeatable ? <MedalTrack item={item} t={t} /> : <SingleMedal item={item} t={t} />}
                  {earned && definition.repeatable ? (
                    <span className="c5-rail__next">{next ? t(next.key, { remaining: next.remaining }) : t("achievements.medal.top")}</span>
                  ) : null}
                </dd>
              </div>
            ) : null}
            {rarity ? (
              <div className="c5-rail__fact">
                <dt>{t("achievements.rarity.title")}</dt>
                <dd>
                  <span className="c5-rarity">
                    <strong className="c5-rarity__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</strong>
                    <span className="c5-rarity__line">{raritySentence(rarity, t, effectiveLanguage, "tab")}</span>
                  </span>
                  <span className="c5-rarity__basis">
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
