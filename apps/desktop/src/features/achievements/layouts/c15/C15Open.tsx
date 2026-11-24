import type { CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementBadgeStage } from "../../achievementBadge";
import { achievementName, formatAchievementDay, medalName, raritySentence, rarityTierName, shownRarity } from "../../achievementCopy";
import { historyEntries, historyFor } from "../../achievementHistory";
import { achievementMilestoneProgress } from "../../achievementMilestones";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import { ordinal, shortDay, TRACK_MARKS, trackPosition } from "./c15Copy";

type OpenProps = {
  readonly item: AchievementItem;
  readonly id: string;
  readonly headingId: string;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
};

/** Gold from ten times, a double rim from fifty: named under their marks. */
const METAL_AT: Readonly<Partial<Record<number, "achievements.medal.gold" | "achievements.medal.ringShort">>> = {
  10: "achievements.medal.gold",
  50: "achievements.medal.ringShort",
};

/** The repeat milestones on one line, the current count marked where it stands. */
function Track({ item, count }: { readonly item: AchievementItem; readonly count: number }) {
  const { t } = useLocalization();
  const stage = achievementBadgeStage(item);
  const milestone = achievementMilestoneProgress(count);
  const next = nextMedal(item);
  return (
    <div className="c15-track-block">
      <p className="c15-track__caption">
        <span className="c15-track__now-text">{t("achievements.medal.now", { count })}</span>
        {milestone ? <span>{t("achievements.milestone.next", { target: milestone.target })}</span> : null}
        <span data-metal={next ? undefined : "top"}>{next ? t(next.key, { remaining: next.remaining }) : t("achievements.medal.top")}</span>
      </p>
      <C15TrackLine item={item} count={count} stage={stage} />
    </div>
  );
}

/** The milestone rail alone, shared by the opened row and the single card. */
export function C15TrackLine({ item, count, stage = achievementBadgeStage(item) }: { readonly item: AchievementItem; readonly count: number; readonly stage?: string }) {
  const { t } = useLocalization();
  const last = TRACK_MARKS.length - 1;
  const nextIndex = TRACK_MARKS.findIndex((mark) => mark > count);
  const lane = nextIndex > 0 ? { "--c15-lane-from": (nextIndex - 1) / last, "--c15-lane-to": nextIndex / last } : null;
  return (
    <div className="c15-track" data-stage={stage} aria-hidden="true" style={{ "--c15-now": trackPosition(count) } as CSSProperties}>
      <span className="c15-track__rail"><span className="c15-track__fill" /></span>
      {lane ? <span className="c15-track__lane" style={lane as CSSProperties} /> : null}
      {TRACK_MARKS.map((mark, index) => {
        const metal = METAL_AT[mark];
        return (
          <span
            key={mark}
            className="c15-track__mark"
            data-reached={count >= mark ? "true" : undefined}
            data-metal={metal ? "true" : undefined}
            data-next={index === nextIndex ? "true" : undefined}
            style={{ "--c15-at": index / last } as CSSProperties}
          >
            <span className="c15-track__num">{mark}</span>
            {metal ? <span className="c15-track__metal">{t(metal)}</span> : null}
          </span>
        );
      })}
      <span className="c15-track__pin"><span className="c15-track__count">{count}</span></span>
    </div>
  );
}

/** The opened row: medal stage, rarity sentence or progress, then the milestone track and every kept day. */
export function C15Open({ item, id, headingId, isNew, onOpenDay }: OpenProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const history = historyFor(item);
  const entries = history ? historyEntries(history) : [];
  const medal = earned ? medalName(item, t) : null;
  const next = nextMedal(item);
  const progress = earned || concealed ? null : progressText(item, t, effectiveLanguage);
  const name = achievementName(item, t);

  return (
    <section id={id} className="c15-open" aria-labelledby={headingId}>
      <h3 id={headingId} className="c15-sr">{name}</h3>
      {earned && (definition.hidden || isNew) ? (
        <p className="c15-open__context">
          {isNew ? <span className="c15-open__new"><span className="c15-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
          {definition.hidden ? <span>{t("achievements.hiddenFound")}</span> : null}
        </p>
      ) : null}
      <dl className="c15-facts">
        {earned && medal ? (
          <div className="c15-fact">
            <dt>{t("achievements.medal.title")}</dt>
            <dd>
              <span className="c15-fact__value" data-stage={achievementBadgeStage(item)}>{medal}</span>
              <span className="c15-fact__note">
                {!definition.repeatable ? t("achievements.medal.once") : next ? t(next.key, { remaining: next.remaining }) : t("achievements.medal.top")}
              </span>
            </dd>
          </div>
        ) : null}
        {rarity ? (
          <div className="c15-fact">
            <dt>{t("achievements.rarity.title")}</dt>
            <dd>
              <span className="c15-fact__value">{rarityTierName(item, rarity, t)}</span>
              <span className="c15-fact__note">{raritySentence(rarity, t, effectiveLanguage, "tab")}</span>
            </dd>
          </div>
        ) : null}
        {!earned && !concealed ? (
          <div className="c15-fact c15-fact--wide">
            <dt>{t("achievements.progress")}</dt>
            <dd>
              {progress ? (
                <>
                  <span className="c15-fact__value">{progress}</span>
                  <span className="c15-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                  <span className="c15-fact__note">{remainingText(item, t, effectiveLanguage)}</span>
                </>
              ) : (
                <span className="c15-fact__value is-quiet">{t("achievements.notEarned")}</span>
              )}
            </dd>
          </div>
        ) : null}
        {concealed ? (
          <div className="c15-fact c15-fact--wide">
            <dt>{t("achievements.progress")}</dt>
            <dd><span className="c15-fact__value is-quiet">{t("achievements.notEarned")}</span></dd>
          </div>
        ) : null}
      </dl>

      {earned && definition.repeatable ? <Track item={item} count={earned.count} /> : null}

      {earned && history && entries.length > 0 ? (
        <div className="c15-days">
          <p className="c15-days__title">{definition.repeatable ? t("achievements.record.title") : t("achievements.stat.earnedOn")}</p>
          <ol className="c15-days__list" data-single={definition.repeatable ? undefined : "true"}>
            {entries.map(({ day, ordinal: count }) => {
              const date = formatAchievementDay(day, effectiveLanguage);
              return (
                <li key={day}>
                  <button
                    type="button"
                    className="c15-day"
                    data-history-day={day}
                    aria-label={t("achievements.c15.historyDay", { nth: ordinal(count, t, effectiveLanguage), date })}
                    onClick={() => onOpenDay(day)}
                  >
                    {definition.repeatable ? <span className="c15-day__nth">{count}</span> : null}
                    <span className="c15-day__date">{definition.repeatable ? shortDay(day, effectiveLanguage) : date}</span>
                  </button>
                </li>
              );
            })}
            {history.earlier > 0 ? (
              <li className="c15-days__earlier" data-history-earlier={history.earlier}>
                {history.earlier === 1 ? t("achievements.c15.earlierOne") : t("achievements.c15.earlier", { count: history.earlier })}
              </li>
            ) : null}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
