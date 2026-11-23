import { Fragment, type Ref } from "react";
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
import { achievementMilestoneProgress } from "../../achievementMilestones";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import { formatRarityBasis } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";
import { C2Plinth } from "./c2Parts";

type TrackStop = { readonly stage: AchievementBadgeStage; readonly from: number; readonly label: TranslationKey };

const REPEATABLE_TRACK: readonly TrackStop[] = [
  { stage: "silver", from: 1, label: "achievements.medal.silver" },
  { stage: "gold", from: GOLD_FROM_COUNT, label: "achievements.medal.gold" },
  { stage: "ring", from: RING_FROM_COUNT, label: "achievements.medal.ringShort" },
];

function oneOffStop(item: AchievementItem): TrackStop {
  const stage = achievementBadgeStage(item.earned ? item : { ...item, earned: { firstDay: "", lastDay: "", count: 1 } });
  return { stage, from: 1, label: stage === "gold" ? "achievements.medal.gold" : "achievements.medal.silver" };
}

function MedalTrack({ item, t }: { readonly item: AchievementItem; readonly t: Translate }) {
  const count = item.earned?.count ?? 0;
  const current = item.earned ? achievementBadgeStage(item) : null;
  const stops = item.definition.repeatable ? REPEATABLE_TRACK : [oneOffStop(item)];
  return (
    <span className="c2-track">
      {stops.map((stop, index) => {
        const previous = stops[index - 1];
        const share = previous ? Math.max(0, Math.min(1, (count - previous.from) / (stop.from - previous.from))) : 0;
        const isCurrent = stop.stage === current;
        const src = achievementBadgeUrl(item.definition.id, stop.stage, true);
        const note = !item.definition.repeatable ? t("achievements.medal.once")
          : isCurrent ? t("achievements.medal.now", { count })
            : t("achievements.medal.from", { count: stop.from });
        return (
          <Fragment key={stop.stage}>
            {previous ? <span className="c2-track__line" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span> : null}
            <span className="c2-track__stop" data-current={isCurrent ? "true" : undefined} aria-current={isCurrent ? "step" : undefined}>
              {src ? <img className="c2-track__medal" src={src} alt="" draggable={false} /> : null}
              <span className="c2-track__name">{t(stop.label)}</span>
              <span className="c2-track__note">{note}</span>
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

type DetailProps = {
  readonly item: AchievementItem;
  readonly id: string;
  readonly onOpenDay?: (day: string) => void;
  readonly detailRef?: Ref<HTMLElement>;
  readonly labelledBy?: string;
};

export function C2Detail({ item, id, onOpenDay, detailRef, labelledBy }: DetailProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const next = nextMedal(item);
  const milestone = earned && definition.repeatable && !next ? achievementMilestoneProgress(earned.count) : null;
  const progress = earned || concealed ? null : progressText(item, t, effectiveLanguage);
  const headingId = id + "-name";

  return (
    <aside ref={detailRef} id={id} className="c2-detail" data-state={earned ? "earned" : "locked"} aria-labelledby={labelledBy ?? headingId}>
      <div className="c2-detail__medal">
        <C2Plinth key={definition.id} item={item} size="detail" arrive />
      </div>
      <div className="c2-detail__body">
        {labelledBy ? null : <h3 id={headingId} className="c2-visually-hidden">{achievementName(item, t)}</h3>}
        {concealed ? (
          <p className="c2-detail__hidden">{achievementCondition(item, t)}</p>
        ) : (
          <dl className="c2-facts">
            <div className="c2-facts__row">
              <dt>{earned ? t("achievements.medal.title") : t("achievements.c2.medalsAhead")}</dt>
              {definition.repeatable ? (
                <dd className="c2-facts__rail">
                  <MedalTrack item={item} t={t} />
                  {earned ? (
                    <span className="c2-facts__next">
                      <strong>{next ? t(next.key, { remaining: next.remaining }) : t("achievements.medal.top")}</strong>
                      {milestone ? <span className="c2-facts__quiet">{t("achievements.milestone.next", { target: milestone.target })}</span> : null}
                    </span>
                  ) : null}
                </dd>
              ) : (
                <dd className="c2-facts__value">
                  <strong>{earned ? medalName(item, t) : t(oneOffStop(item).label)}</strong>
                  <span className="c2-facts__quiet">{t("achievements.medal.once")}</span>
                </dd>
              )}
            </div>

            {earned ? (
              <div className="c2-facts__row">
                <dt>{t("achievements.record.title")}</dt>
                <dd className="c2-stats">
                  {definition.repeatable && earned.count > 1 ? (
                    <>
                      <span className="c2-stats__item"><span>{t("achievements.stat.first")}</span><strong>{formatAchievementDay(earned.firstDay, effectiveLanguage)}</strong></span>
                      <span className="c2-stats__item"><span>{t("achievements.stat.last")}</span><strong>{formatAchievementDay(earned.lastDay, effectiveLanguage)}</strong></span>
                      <span className="c2-stats__item"><span>{t("achievements.stat.count")}</span><strong>{timesLabel(earned.count, t)}</strong></span>
                    </>
                  ) : (
                    <span className="c2-stats__item"><span>{t("achievements.stat.earnedOn")}</span><strong>{formatAchievementDay(achievementDay(item) ?? earned.firstDay, effectiveLanguage)}</strong></span>
                  )}
                  {onOpenDay ? (
                    <span className="c2-stats__action">
                      <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => onOpenDay(achievementDay(item) ?? earned.firstDay)}>
                        {t("achievements.openDay")}
                      </button>
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : progress ? (
              <div className="c2-facts__row">
                <dt>{t("achievements.progress")}</dt>
                <dd className="c2-progress">
                  <span className="c2-bar c2-bar--wide" data-tone="accent" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                  <span className="c2-progress__text">
                    {progress}
                    {progressShare(item) < 1 ? <strong className="c2-progress__left">{remainingText(item, t, effectiveLanguage)}</strong> : null}
                  </span>
                </dd>
              </div>
            ) : null}

            {rarity ? (
              <div className="c2-facts__row">
                <dt>{t("achievements.rarity.title")}</dt>
                <dd className="c2-rarity-line">
                  <span>
                    {raritySentence(rarity, t, effectiveLanguage, "tab")}
                    <span aria-hidden="true"> · </span>
                    <strong className="c2-rarity-line__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</strong>
                  </span>
                  <span className="c2-rarity-line__note">
                    {rarityReadsAsFew(rarity)
                      ? t("achievements.rarity.basisShort")
                      : t("achievements.rarity.basis", { count: formatRarityBasis(rarity.basisCount, effectiveLanguage) })}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </div>
    </aside>
  );
}
