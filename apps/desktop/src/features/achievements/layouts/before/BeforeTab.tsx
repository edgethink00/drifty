import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { AchievementMedal } from "../../AchievementMedal";
import { achievementTier, formatRarityBasis, formatRarityPercent } from "../../achievementRarity";
import { achievementMilestoneProgress } from "../../achievementMilestones";
import { achievementBadgeStage, type AchievementBadgeStage } from "../../achievementBadge";
import { achievementCondition, achievementDay, achievementName, formatAchievementDay } from "../../achievementCopy";
import { nextMedal, progressShare, progressText } from "../../achievementProgress";
import type { AchievementLayoutTabProps } from "../types";
import { BeforeShowcase } from "./BeforeShowcase";
import "./before.css";

const MEDAL_LABELS: Partial<Record<AchievementBadgeStage, TranslationKey>> = {
  silver: "achievements.medal.silver",
  gold: "achievements.medal.gold",
  ring: "achievements.before.medal.ring",
};

/** The double-rim line read differently in this layout; gold reads the same. */
function beforeMedalKey(key: TranslationKey): TranslationKey {
  return key === "achievements.medal.toRing" ? "achievements.before.medal.toRing" : key;
}

/** Insights › Achievements: every achievement by group, with the chosen one's detail beside the grid. */
export function BeforeTab({ model }: AchievementLayoutTabProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, items, byGroup, earnedCount, selected, choose, isNew, onOpenDay, onRetry } = model;
  const selectedProgress = selected && !selected.earned ? progressText(selected, t, effectiveLanguage) : null;
  const selectedMedal = selected ? nextMedal(selected) : null;
  const selectedMilestone = !selectedMedal && selected?.earned && selected.definition.repeatable ? achievementMilestoneProgress(selected.earned.count) : null;
  const selectedMedalLabel = selected?.earned ? MEDAL_LABELS[achievementBadgeStage(selected)] : undefined;
  const selectedDay = selected?.earned ? achievementDay(selected) ?? selected.earned.firstDay : null;

  return (
    <>
      <div className="achievements__summary">
        <strong className="achievements__count">{t("achievements.before.summary", { earned: earnedCount, total: items.length })}</strong>
        <span className="achievements__bar" aria-hidden="true"><span style={{ width: Math.round((earnedCount / Math.max(1, items.length)) * 100) + "%" }} /></span>
        {model.loading ? (
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
              <div className="achievements__group-head">
                <h2 id={"achievements-group-" + group} className="label-mono insight-section__label achievements__group-title">{t(("achievements.group." + group) as TranslationKey)}</h2>
                <span className="achievements__group-count">{groupItems.filter((item) => item.earned).length}/{groupItems.length}</span>
              </div>
              <div className="achievements__grid">
                {groupItems.map((item) => {
                  const name = achievementName(item, t);
                  const earned = item.earned;
                  const share = progressShare(item);
                  return (
                    <button
                      key={item.definition.id}
                      type="button"
                      className={"achievement-tile" + (earned ? " is-earned" : "")}
                      aria-pressed={item.definition.id === selected?.definition.id}
                      aria-label={t(earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
                      onClick={() => choose(item.definition.id)}
                    >
                      <AchievementMedal item={item} />
                      {isNew(item) ? <span className="achievement-tile__new" aria-hidden="true" /> : null}
                      <span className="achievement-tile__name">{name}</span>
                      <span className="achievement-tile__meta">
                        {earned
                          ? formatAchievementDay(achievementDay(item) ?? earned.firstDay, effectiveLanguage) + (item.definition.repeatable && earned.count > 1 ? " · " + t("achievements.before.countShort", { count: earned.count }) : "")
                          : item.definition.hidden ? t("achievements.before.hiddenShort") : progressText(item, t, effectiveLanguage) ?? t("achievements.before.notYet")}
                      </span>
                      {!earned && share > 0 ? (
                        <span className="achievement-tile__progress" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span>
                      ) : null}
                      {item.rarity && !(item.definition.hidden && !earned) ? (
                        <span className="achievement-tile__rarity" data-tier={achievementTier(item.definition, item.rarity)}>
                          {t("achievements.before.rarity.tile", { percent: formatRarityPercent(item.rarity.percent, effectiveLanguage) })}
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
              <BeforeShowcase item={selected} size="detail" />
            </div>
            <div className="achievements__detail-body">
            <h3 className="achievements__detail-name">{achievementName(selected, t)}</h3>
            <p className="achievements__detail-condition">{achievementCondition(selected, t)}</p>
            {selectedMedal ? (
              <div className="achievements__milestone">
                <div className="achievements__progress-row">
                  <span>{t("achievements.before.medal.next")}</span>
                  <strong>{t(beforeMedalKey(selectedMedal.key), { remaining: selectedMedal.remaining })}</strong>
                </div>
                <span className="achievements__bar achievements__bar--wide achievements__bar--milestone" aria-hidden="true"><span style={{ width: Math.round(selectedMedal.share * 100) + "%" }} /></span>
              </div>
            ) : selectedMilestone ? (
              <div className="achievements__milestone">
                <div className="achievements__progress-row">
                  <span>{t("achievements.before.milestone.title")}</span>
                  <strong>{t("achievements.before.milestone.remaining", { remaining: selectedMilestone.remaining, target: selectedMilestone.target })}</strong>
                </div>
                <span className="achievements__bar achievements__bar--wide achievements__bar--milestone" aria-hidden="true"><span style={{ width: Math.round(selectedMilestone.share * 100) + "%" }} /></span>
              </div>
            ) : null}
            {selected.earned ? (
              <dl className="achievements__facts">
                {selectedMedalLabel ? <div><dt>{t("achievements.medal.title")}</dt><dd>{t(selectedMedalLabel)}</dd></div> : null}
                <div><dt>{t("achievements.before.firstEarned")}</dt><dd>{formatAchievementDay(selected.earned.firstDay, effectiveLanguage)}</dd></div>
                {selected.definition.repeatable && selected.earned.count > 1 ? (
                  <>
                    <div><dt>{t("achievements.before.lastEarned")}</dt><dd>{formatAchievementDay(selected.earned.lastDay, effectiveLanguage)}</dd></div>
                    <p className="achievements__times">{t("achievements.before.count", { count: selected.earned.count })}</p>
                  </>
                ) : null}
              </dl>
            ) : selectedProgress ? (
              <div className="achievements__progress">
                <div className="achievements__progress-row"><span>{t("achievements.before.progress")}</span><strong>{selectedProgress}</strong></div>
                <span className="achievements__bar achievements__bar--wide" aria-hidden="true"><span style={{ width: Math.round(progressShare(selected) * 100) + "%" }} /></span>
              </div>
            ) : null}
            {selected.rarity && !(selected.definition.hidden && !selected.earned) ? (
              <div className="achievements__rarity" data-tier={achievementTier(selected.definition, selected.rarity)}>
                <div className="achievements__progress-row">
                  <span>{t("achievements.rarity.title")}</span>
                  <strong className="achievements__tier">{t(("achievements.tier." + achievementTier(selected.definition, selected.rarity)) as TranslationKey)}</strong>
                </div>
                <p className="achievements__rarity-line">{t("achievements.before.rarity.detail", { percent: formatRarityPercent(selected.rarity.percent, effectiveLanguage) })}</p>
                <span className="achievements__bar achievements__bar--wide achievements__bar--rarity" aria-hidden="true"><span style={{ width: Math.max(2, Math.min(100, selected.rarity.percent)) + "%" }} /></span>
                <p className="achievements__times">{t("achievements.rarity.basis", { count: formatRarityBasis(selected.rarity.basisCount, effectiveLanguage) })}</p>
              </div>
            ) : null}
            {selectedDay ? (
              <button type="button" className="app-btn app-btn--secondary achievements__open-day" onClick={() => onOpenDay(selectedDay)}>
                {t("achievements.openDay")}
              </button>
            ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </>
  );
}
