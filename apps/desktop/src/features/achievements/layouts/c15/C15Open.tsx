import { useState, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementBadgeStage } from "../../achievementBadge";
import { achievementName, formatAchievementDay, medalName, raritySentence, shownRarity } from "../../achievementCopy";
import { historyEntries, historyFor } from "../../achievementHistory";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import { formatRarityPercent } from "../../achievementRarity";
import { useActiveAchievementOpenStyle } from "../../achievementDesignReview";
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
function C15OpenFull({ item, id, headingId, isNew, onOpenDay }: OpenProps) {
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
              <span className="c15-fact__value">{t("achievements.rarity.detail", { percent: formatRarityPercent(rarity.percent, effectiveLanguage) })}</span>
              {raritySentence(rarity, t, effectiveLanguage, "tab") !== t("achievements.rarity.detail", { percent: formatRarityPercent(rarity.percent, effectiveLanguage) })
                ? <span className="c15-fact__note">{raritySentence(rarity, t, effectiveLanguage, "tab")}</span>
                : null}
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

      {earned && definition.repeatable ? <div className="c15-track-block"><C15TrackLine item={item} count={earned.count} /></div> : null}

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

/** The day buttons of a kept history, newest first; shared by the opened-row styles. */
function DayButtons({ item, entries, onOpenDay }: { readonly item: AchievementItem; readonly entries: readonly { readonly day: string; readonly ordinal: number }[]; readonly onOpenDay: (day: string) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const repeatable = item.definition.repeatable;
  return (
    <>
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
              {repeatable ? <span className="c15-day__nth">{count}</span> : null}
              <span className="c15-day__date">{repeatable ? shortDay(day, effectiveLanguage) : date}</span>
            </button>
          </li>
        );
      })}
    </>
  );
}

/** Recent days a "brief" opened row shows before "all days". */
const BRIEF_DAYS = 3;

/** The facts of an opened row as short plain sentences: what it took, the medal and what comes next, when. */
function useOpenFacts(item: AchievementItem) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const next = nextMedal(item);
  const medal = earned ? medalName(item, t) : null;
  const medalNote = earned ? (!definition.repeatable ? null : next ? t(next.key, { remaining: next.remaining }) : t("achievements.medal.top")) : null;
  const rarity = shownRarity(item);
  const fewSentence = rarity && raritySentence(rarity, t, effectiveLanguage, "tab") !== t("achievements.rarity.detail", { percent: formatRarityPercent(rarity.percent, effectiveLanguage) })
    ? raritySentence(rarity, t, effectiveLanguage, "tab")
    : null;
  let lead: string;
  let sub: string | null = null;
  if (earned && definition.repeatable && earned.count > 1) {
    lead = [t("achievements.c15.brief.times", { count: earned.count }), [medal, medalNote].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    sub = t("achievements.c15.brief.firstLatest", { first: formatAchievementDay(earned.firstDay, effectiveLanguage), latest: formatAchievementDay(earned.lastDay, effectiveLanguage) });
  } else if (earned) {
    lead = [t("achievements.c15.brief.earnedOn", { date: formatAchievementDay(earned.lastDay, effectiveLanguage) }), [medal, medalNote].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  } else if (!concealed) {
    const progress = progressText(item, t, effectiveLanguage);
    lead = progress ? [progress, remainingText(item, t, effectiveLanguage)].filter(Boolean).join(" · ") : t("achievements.notEarned");
  } else {
    lead = t("achievements.notEarned");
  }
  return { lead, sub, fewSentence };
}

function OpenContext({ item, isNew }: { readonly item: AchievementItem; readonly isNew: boolean }) {
  const { t } = useLocalization();
  if (!item.earned || !(item.definition.hidden || isNew)) return null;
  return (
    <p className="c15-open__context">
      {isNew ? <span className="c15-open__new"><span className="c15-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
      {item.definition.hidden ? <span>{t("achievements.hiddenFound")}</span> : null}
    </p>
  );
}

/** "brief": two short lines, the latest few days, and every day only when asked. */
function C15OpenBrief({ item, id, headingId, isNew, onOpenDay }: OpenProps) {
  const { t } = useLocalization();
  const [all, setAll] = useState(false);
  const { lead, sub, fewSentence } = useOpenFacts(item);
  const history = item.earned ? historyFor(item) : null;
  const entries = history ? historyEntries(history) : [];
  const shown = all ? entries : entries.slice(0, BRIEF_DAYS);
  const total = item.earned?.count ?? 0;
  return (
    <section id={id} className="c15-open c15-open--brief" aria-labelledby={headingId}>
      <h3 id={headingId} className="c15-sr">{achievementName(item, t)}</h3>
      <OpenContext item={item} isNew={isNew} />
      <p className="c15-brief__lead">{lead}</p>
      {sub || fewSentence ? <p className="c15-brief__sub">{[sub, fewSentence].filter(Boolean).join(" · ")}</p> : null}
      {entries.length > 0 && !item.definition.repeatable ? (
        // A one-off already names its day in the lead line; offer only the way to it.
        <button type="button" className="c15-brief__more" data-history-day={entries[0].day} onClick={() => onOpenDay(entries[0].day)}>
          {t("achievements.c15.brief.openDay")}
        </button>
      ) : null}
      {entries.length > 0 && item.definition.repeatable ? (
        <div className="c15-brief__days">
          <ol className={all ? "c15-days__list" : "c15-brief__recent"}>
            <DayButtons item={item} entries={shown} onOpenDay={onOpenDay} />
            {all && history && history.earlier > 0 ? (
              <li className="c15-days__earlier" data-history-earlier={history.earlier}>
                {history.earlier === 1 ? t("achievements.c15.earlierOne") : t("achievements.c15.earlier", { count: history.earlier })}
              </li>
            ) : null}
          </ol>
          {item.definition.repeatable && total > BRIEF_DAYS ? (
            <button type="button" className="c15-brief__more" aria-expanded={all} onClick={() => setAll((value) => !value)}>
              {all ? t("achievements.c15.brief.showLess") : t("achievements.c15.brief.showAll", { count: total })}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** "line": one line of facts and a way to the latest day; nothing more. */
function C15OpenLine({ item, id, headingId, isNew, onOpenDay }: OpenProps) {
  const { t } = useLocalization();
  const { lead, sub } = useOpenFacts(item);
  const history = item.earned ? historyFor(item) : null;
  const latest = history ? historyEntries(history)[0] : undefined;
  return (
    <section id={id} className="c15-open c15-open--line" aria-labelledby={headingId}>
      <h3 id={headingId} className="c15-sr">{achievementName(item, t)}</h3>
      <OpenContext item={item} isNew={isNew} />
      <div className="c15-line">
        <p className="c15-line__text">{[lead, sub].filter(Boolean).join(" · ")}</p>
        {latest ? (
          <button type="button" className="app-btn app-btn--secondary app-btn--compact c15-line__open" data-history-day={latest.day} onClick={() => onOpenDay(latest.day)}>
            {t(item.definition.repeatable ? "achievements.c15.brief.openLatest" : "achievements.c15.brief.openDay")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** The opened row, in the style under review (the full one outside the review). */
export function C15Open(props: OpenProps) {
  const style = useActiveAchievementOpenStyle();
  if (style === "brief") return <C15OpenBrief {...props} />;
  if (style === "line") return <C15OpenLine {...props} />;
  return <C15OpenFull {...props} />;
}
