import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { Translate } from "../localization/translate";
import type { TranslationKey } from "../localization/translations";
import type { DisplayLanguage } from "../localization/languagePreference";
import { ACHIEVEMENT_GROUPS, type AchievementId } from "./achievementCatalog";
import { AchievementMedal } from "./AchievementMedal";
import { AchievementShowcase } from "./AchievementShowcase";
import type { AchievementItem, AchievementsSnapshot } from "./useAchievements";
import { formatRarityBasis } from "./achievementRarity";
import { achievementMilestoneProgress } from "./achievementMilestones";
import { isAchievementDesignReview, useAchievementReviewState } from "./achievementDesignReview";
import { GOLD_FROM_COUNT, RING_FROM_COUNT, achievementBadgeStage, achievementBadgeUrl, type AchievementBadgeStage } from "./achievementBadge";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  daysLabel,
  formatAchievementDay,
  medalName,
  rarityIsNotable,
  rarityReadsAsFew,
  raritySentence,
  rarityTierName,
  shownRarity,
  timesLabel,
} from "./achievementCopy";
import "./achievement-medal.css";
import "./achievements.css";

export { achievementCondition, achievementDay, achievementName, formatAchievementDay } from "./achievementCopy";

function progressShare(item: AchievementItem): number {
  const progress = item.progress;
  if (!progress || progress.target <= 0) return 0;
  return Math.max(0, Math.min(1, progress.current / progress.target));
}

function progressText(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const progress = item.progress;
  if (!progress || progress.current <= 0) return null;
  if (progress.unit === "days") return t("achievements.daysProgress", { current: progress.current, target: progress.target });
  return formatLocalizedCompactDurationFromSeconds(progress.current, language) + " / " + formatLocalizedCompactDurationFromSeconds(progress.target, language);
}

function remainingText(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const progress = item.progress;
  if (!progress) return null;
  const left = Math.max(0, progress.target - progress.current);
  return t("achievements.left", {
    amount: progress.unit === "days" ? daysLabel(left, t) : formatLocalizedCompactDurationFromSeconds(left, language),
  });
}

/** Locked achievements already under way, closest to done first. Hidden ones stay out until earned. */
export function closestAchievements(items: readonly AchievementItem[], limit = 2): AchievementItem[] {
  return items
    .filter((item) => !item.earned && !item.definition.hidden && item.progress !== null
      && item.progress.current > 0 && item.progress.current < item.progress.target)
    .sort((left, right) => progressShare(right) - progressShare(left))
    .slice(0, limit);
}

/** How far a repeatable medal is from its next metal: gold at ten times, a double rim at fifty. */
export function nextMedal(item: AchievementItem): { readonly key: TranslationKey; readonly remaining: number; readonly share: number } | null {
  const count = item.earned?.count ?? 0;
  if (!item.earned || !item.definition.repeatable) return null;
  if (count < GOLD_FROM_COUNT) return { key: "achievements.medal.toGold", remaining: GOLD_FROM_COUNT - count, share: count / GOLD_FROM_COUNT };
  if (count < RING_FROM_COUNT) return { key: "achievements.medal.toRing", remaining: RING_FROM_COUNT - count, share: (count - GOLD_FROM_COUNT) / (RING_FROM_COUNT - GOLD_FROM_COUNT) };
  return null;
}

/** The achievement shown first: one just earned, else the latest earned, else the first in the list. */
export function initialAchievementSelection(items: readonly AchievementItem[], unannounced: readonly AchievementId[]): AchievementId {
  if (unannounced.length > 0) return unannounced[0];
  const latest = items.filter((item) => item.earned).sort((left, right) => (right.earned?.lastDay ?? "").localeCompare(left.earned?.lastDay ?? ""))[0];
  return (latest ?? items[0]).definition.id;
}

/** Design review only: draw a locked achievement as if it had been earned. */
export function asEarnedForReview(item: AchievementItem): AchievementItem {
  return item.earned ? item : { ...item, earned: { firstDay: "2026-11-01", lastDay: "2026-11-01", count: 1 } };
}

const STAGE_SCROLL_MARGIN_PX = 20;

function scrollContainer(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

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
  readonly stageRef: (node: HTMLElement | null) => void;
};

function AchievementStage({ item, isNew, onOpenDay, stageRef }: StageProps) {
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
        <AchievementShowcase key={definition.id} item={item} size="detail" />
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

function AchievementsLoading({ label }: { readonly label: string }) {
  return (
    <div className="achievements-loading">
      <div className="achievements-loading__stage">
        <span className="achievements-loading__medal" aria-hidden="true" />
        <div className="achievements-loading__story">
          <p className="achievements-loading__label" role="status">{label}</p>
          <span className="achievements-loading__block is-title" aria-hidden="true" />
          <span className="achievements-loading__block is-line" aria-hidden="true" />
          <span className="achievements-loading__rows" aria-hidden="true"><span /><span /><span /></span>
        </div>
      </div>
      <div className="achievements-loading__shelf" aria-hidden="true">
        {ACHIEVEMENT_GROUPS.map((group) => (
          <span key={group} className="achievements-loading__group"><span /><span /><span /></span>
        ))}
      </div>
    </div>
  );
}

type AchievementsPanelProps = {
  readonly snapshot: AchievementsSnapshot;
  readonly onRetry: () => void;
  readonly onOpenDay: (day: string) => void;
  /** Called once the tab has shown achievements the person had not seen yet. */
  readonly onSeen: (ids: readonly AchievementId[]) => void;
};

/** Insights › Achievements: the chosen achievement on a stage, then the whole collection by group. */
export function AchievementsPanel({ snapshot, onRetry, onOpenDay, onSeen }: AchievementsPanelProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, unannounced } = snapshot;
  const review = isAchievementDesignReview();
  const { allEarned } = useAchievementReviewState();
  const items = useMemo(
    () => (review && allEarned ? snapshot.items.map(asEarnedForReview) : snapshot.items),
    [allEarned, review, snapshot.items],
  );
  // Remember what was new when the tab opened so it stays marked during this visit.
  const newOnArrival = useRef<ReadonlySet<AchievementId>>(new Set(unannounced));
  const [selectedId, setSelectedId] = useState<AchievementId>(() => initialAchievementSelection(items, unannounced));
  useEffect(() => {
    if (unannounced.length === 0) return;
    for (const id of unannounced) (newOnArrival.current as Set<AchievementId>).add(id);
    onSeen(unannounced);
  }, [onSeen, unannounced]);

  // Choosing from the shelf brings the stage back into view when it has scrolled away.
  const stageNode = useRef<HTMLElement | null>(null);
  const stageRef = useCallback((node: HTMLElement | null) => { stageNode.current = node; }, []);
  const choose = useCallback((id: AchievementId) => {
    setSelectedId(id);
    const node = stageNode.current;
    if (!node) return;
    const scroller = scrollContainer(node);
    const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const box = node.getBoundingClientRect();
    if (box.top >= view.top && box.bottom <= view.bottom) return;
    const contentTop = box.top + Number.parseFloat(getComputedStyle(node).paddingTop);
    const top = contentTop - view.top - STAGE_SCROLL_MARGIN_PX;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    (scroller ?? window).scrollBy({ top, behavior });
  }, []);

  const earnedCount = items.filter((item) => item.earned).length;
  const selected = items.find((item) => item.definition.id === selectedId) ?? items[0];
  const byGroup = useMemo(() => ACHIEVEMENT_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.definition.group === group),
  })), [items]);
  const closest = useMemo(() => closestAchievements(items), [items]);

  if (status === "loading" && earnedCount === 0) {
    return (
      <section className="achievements" id="insights-tabpanel-achievements" role="tabpanel" aria-labelledby="insights-tab-achievements" aria-busy="true">
        <AchievementsLoading label={t("achievements.loading")} />
      </section>
    );
  }

  const failedEmpty = status === "error" && earnedCount === 0;

  return (
    <section className="achievements" id="insights-tabpanel-achievements" role="tabpanel" aria-labelledby="insights-tab-achievements">
      {failedEmpty ? (
        <div className="achievements-error" role="alert">
          <p>{t("achievements.error")}</p>
          <button type="button" className="app-btn app-btn--secondary" onClick={onRetry}>{t("achievements.retry")}</button>
        </div>
      ) : selected ? (
        <AchievementStage
          item={selected}
          isNew={selected.earned !== null && newOnArrival.current.has(selected.definition.id)}
          onOpenDay={onOpenDay}
          stageRef={stageRef}
        />
      ) : null}

      <div className="achievements__summary">
        <p className="achievements__count">{t("achievements.summary", { earned: earnedCount, total: items.length })}</p>
        {status === "error" && !failedEmpty ? (
          <p className="achievements__notice" role="alert">
            <span>{t("achievements.error")}</span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </p>
        ) : closest.length > 0 ? (
          <p className="achievements__near">
            <span className="achievements__near-title">{t("achievements.near.title")}</span>
            {closest.map((item) => (
              <Fragment key={item.definition.id}>
                <span className="achievements__near-sep" aria-hidden="true">·</span>
                <button type="button" className="achievements__near-item" onClick={() => choose(item.definition.id)}>
                  <span className="achievements__near-text"><span className="achievements__near-name">{achievementName(item, t)}</span> {remainingText(item, t, effectiveLanguage)}</span>
                </button>
              </Fragment>
            ))}
          </p>
        ) : null}
      </div>

      <div className="achievement-shelf">
        {byGroup.map(({ group, items: groupItems }) => (
          <section key={group} className="achievement-shelf__group" aria-labelledby={"achievements-group-" + group}>
            <div className="achievement-shelf__head">
              <h2 id={"achievements-group-" + group} className="achievement-shelf__title">{t(("achievements.group." + group) as TranslationKey)}</h2>
              <span className="achievement-shelf__count">{groupItems.filter((item) => item.earned).length}/{groupItems.length}</span>
            </div>
            <div className="achievement-shelf__tiles">
              {groupItems.map((item) => {
                const name = achievementName(item, t);
                const earned = item.earned;
                const isNew = earned !== null && newOnArrival.current.has(item.definition.id);
                const meta = !earned ? null
                  : item.definition.repeatable && earned.count > 1 ? timesLabel(earned.count, t)
                    : formatAchievementDay(achievementDay(item) ?? earned.firstDay, effectiveLanguage);
                return (
                  <button
                    key={item.definition.id}
                    type="button"
                    className="achievement-tile"
                    data-state={earned ? "earned" : "locked"}
                    aria-pressed={item.definition.id === selected?.definition.id}
                    aria-label={t(earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
                    onClick={() => choose(item.definition.id)}
                  >
                    <AchievementMedal item={item} />
                    <span className="achievement-tile__name">{name}</span>
                    {meta ? (
                      <span className="achievement-tile__meta">
                        {isNew ? <span className="achievement-tile__dot" aria-hidden="true" /> : null}
                        {meta}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <p className="achievements__footnote" role={status === "loading" ? "status" : undefined}>
        {status === "loading" ? t("achievements.loading") : t("achievements.note")}
      </p>
    </section>
  );
}
