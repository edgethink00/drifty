import { useEffect, useMemo, useRef, useState } from "react";
import { formatLocalizedCompactDurationFromSeconds, localeForDisplayLanguage } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { Translate } from "../localization/translate";
import type { TranslationKey } from "../localization/translations";
import type { DisplayLanguage } from "../localization/languagePreference";
import { ACHIEVEMENT_GROUPS, type AchievementId } from "./achievementCatalog";
import { AchievementMedal } from "./AchievementMedal";
import { AchievementShowcase } from "./AchievementShowcase";
import type { AchievementItem, AchievementsSnapshot } from "./useAchievements";
import { achievementTier, formatRarityBasis, formatRarityPercent } from "./achievementRarity";
import { achievementMilestoneProgress } from "./achievementMilestones";
import { isAchievementDesignReview, useAchievementReviewState } from "./achievementDesignReview";
import { AchievementDesignReviewBar } from "./AchievementDesignReviewBar";
import "./achievements.css";

export function achievementName(item: AchievementItem, t: Translate): string {
  return item.definition.hidden && !item.earned
    ? t("achievements.hiddenName")
    : t(("achievements." + item.definition.id + ".name") as TranslationKey);
}

export function achievementCondition(item: AchievementItem, t: Translate): string {
  return item.definition.hidden && !item.earned
    ? t("achievements.hiddenCondition")
    : t(("achievements." + item.definition.id + ".condition") as TranslationKey);
}

export function formatAchievementDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = year === today.getFullYear()
    ? { month: "long", day: "numeric" }
    : { year: "numeric", month: "long", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(new Date(year, month - 1, date, 12));
}

function progressText(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const progress = item.progress;
  if (!progress) return null;
  if (progress.unit === "days") return t("achievements.daysProgress", { current: progress.current, target: progress.target });
  return formatLocalizedCompactDurationFromSeconds(progress.current, language) + " / " + formatLocalizedCompactDurationFromSeconds(progress.target, language);
}

function progressShare(item: AchievementItem): number {
  const progress = item.progress;
  if (!progress || progress.target <= 0) return 0;
  return Math.max(0, Math.min(1, progress.current / progress.target));
}

/** The day an earned achievement points to: the latest time for repeatable ones, else the day it was reached. */
export function achievementDay(item: AchievementItem): string | null {
  if (!item.earned) return null;
  return item.definition.repeatable ? item.earned.lastDay : item.earned.firstDay;
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

type AchievementsPanelProps = {
  readonly snapshot: AchievementsSnapshot;
  readonly onRetry: () => void;
  readonly onOpenDay: (day: string) => void;
  /** Called once the tab has shown achievements the person had not seen yet. */
  readonly onSeen: (ids: readonly AchievementId[]) => void;
};

/** Insights › Achievements: every achievement by group, with the chosen one's detail beside the grid. */
export function AchievementsPanel({ snapshot, onRetry, onOpenDay, onSeen }: AchievementsPanelProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, unannounced } = snapshot;
  const review = isAchievementDesignReview();
  const { variant, allEarned } = useAchievementReviewState();
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

  const earnedCount = items.filter((item) => item.earned).length;
  const selected = items.find((item) => item.definition.id === selectedId) ?? items[0];
  const byGroup = useMemo(() => ACHIEVEMENT_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.definition.group === group),
  })), [items]);
  const selectedProgress = selected && !selected.earned ? progressText(selected, t, effectiveLanguage) : null;
  const selectedMilestone = selected?.earned && selected.definition.repeatable ? achievementMilestoneProgress(selected.earned.count) : null;
  const plate = variant === "plate";

  return (
    <section className={plate ? "achievements achievements--plate" : "achievements"} id="insights-tabpanel-achievements" role="tabpanel" aria-labelledby="insights-tab-achievements">
      {review ? <AchievementDesignReviewBar items={snapshot.items} /> : null}
      <div className="achievements__summary">
        <strong className="achievements__count">{t("achievements.summary", { earned: earnedCount, total: items.length })}</strong>
        <span className="achievements__bar" aria-hidden="true"><span style={{ width: Math.round((earnedCount / Math.max(1, items.length)) * 100) + "%" }} /></span>
        {status === "loading" && earnedCount === 0 ? (
          <span className="achievements__status" role="status">{t("achievements.loading")}</span>
        ) : status === "error" ? (
          <span className="achievements__status achievements__status--error" role="alert">
            {t("achievements.error")}
            <button type="button" className="app-btn app-btn--quiet app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </span>
        ) : (
          <span className="achievements__status">{t("achievements.note")}</span>
        )}
      </div>

      <div className="achievements__layout">
        <div className="editorial-panel editorial-panel--soft insight-section achievements__groups">
          {byGroup.map(({ group, items: groupItems }) => (
            <section key={group} className="achievements__group" aria-labelledby={"achievements-group-" + group}>
              <h2 id={"achievements-group-" + group} className="label-mono insight-section__label achievements__group-title">{t(("achievements.group." + group) as TranslationKey)}</h2>
              <div className="achievements__grid">
                {groupItems.map((item) => {
                  const name = achievementName(item, t);
                  const earned = item.earned;
                  const isNew = earned !== null && newOnArrival.current.has(item.definition.id);
                  const share = progressShare(item);
                  return (
                    <button
                      key={item.definition.id}
                      type="button"
                      className={"achievement-tile" + (earned ? " is-earned" : "")}
                      aria-pressed={item.definition.id === selected?.definition.id}
                      aria-label={t(earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
                      onClick={() => setSelectedId(item.definition.id)}
                    >
                      <AchievementMedal item={item} />
                      {isNew ? <span className="achievement-tile__new" aria-hidden="true" /> : null}
                      <span className="achievement-tile__name">{name}</span>
                      <span className="achievement-tile__meta">
                        {earned
                          ? formatAchievementDay(achievementDay(item) ?? earned.firstDay, effectiveLanguage) + (!plate && item.definition.repeatable && earned.count > 1 ? " · " + t("achievements.countShort", { count: earned.count }) : "")
                          : item.definition.hidden ? t("achievements.hiddenShort") : t("achievements.notYet")}
                      </span>
                      {!earned && share > 0 ? (
                        <span className="achievement-tile__progress" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span>
                      ) : null}
                      {item.rarity && !(item.definition.hidden && !earned) ? (
                        <span className="achievement-tile__rarity" data-tier={achievementTier(item.definition, item.rarity)}>
                          {t("achievements.rarity.tile", { percent: formatRarityPercent(item.rarity.percent, effectiveLanguage) })}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {selected ? (
          <aside className="editorial-panel editorial-panel--soft insight-section achievements__detail" data-group={selected.definition.group} data-state={selected.earned ? "earned" : "locked"} aria-live="polite">
            <div className="achievements__detail-stage">
              <AchievementShowcase item={selected} size="detail" />
            </div>
            <div className="achievements__detail-body">
            <h3 className="achievements__detail-name">{achievementName(selected, t)}</h3>
            <p className="achievements__detail-condition">{achievementCondition(selected, t)}</p>
            {selectedMilestone ? (
              <div className="achievements__milestone">
                <div className="achievements__progress-row">
                  <span>{t("achievements.milestone.title")}</span>
                  <strong>{t("achievements.milestone.remaining", { remaining: selectedMilestone.remaining, target: selectedMilestone.target })}</strong>
                </div>
                <span className="achievements__bar achievements__bar--wide achievements__bar--milestone" aria-hidden="true"><span style={{ width: Math.round(selectedMilestone.share * 100) + "%" }} /></span>
              </div>
            ) : null}
            {selected.earned ? (
              <dl className="achievements__facts">
                <div><dt>{t("achievements.firstEarned")}</dt><dd>{formatAchievementDay(selected.earned.firstDay, effectiveLanguage)}</dd></div>
                {selected.definition.repeatable && selected.earned.count > 1 ? (
                  <>
                    <div><dt>{t("achievements.lastEarned")}</dt><dd>{formatAchievementDay(selected.earned.lastDay, effectiveLanguage)}</dd></div>
                    <p className="achievements__times">{t("achievements.count", { count: selected.earned.count })}</p>
                  </>
                ) : null}
              </dl>
            ) : selectedProgress ? (
              <div className="achievements__progress">
                <div className="achievements__progress-row"><span>{t("achievements.progress")}</span><strong>{selectedProgress}</strong></div>
                <span className="achievements__bar achievements__bar--wide" aria-hidden="true"><span style={{ width: Math.round(progressShare(selected) * 100) + "%" }} /></span>
              </div>
            ) : null}
            {selected.rarity && !(selected.definition.hidden && !selected.earned) ? (
              <div className="achievements__rarity" data-tier={achievementTier(selected.definition, selected.rarity)}>
                <div className="achievements__progress-row">
                  <span>{t("achievements.rarity.title")}</span>
                  <strong className="achievements__tier">{t(("achievements.tier." + achievementTier(selected.definition, selected.rarity)) as TranslationKey)}</strong>
                </div>
                <p className="achievements__rarity-line">{t("achievements.rarity.detail", { percent: formatRarityPercent(selected.rarity.percent, effectiveLanguage) })}</p>
                <span className="achievements__bar achievements__bar--wide achievements__bar--rarity" aria-hidden="true"><span style={{ width: Math.max(2, Math.min(100, selected.rarity.percent)) + "%" }} /></span>
                <p className="achievements__times">{t("achievements.rarity.basis", { count: formatRarityBasis(selected.rarity.basisCount, effectiveLanguage) })}</p>
              </div>
            ) : null}
            {selected.earned ? (
              <button type="button" className="app-btn app-btn--secondary achievements__open-day" onClick={() => onOpenDay(achievementDay(selected) ?? selected.earned!.firstDay)}>
                {t("achievements.openDay")}
              </button>
            ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

