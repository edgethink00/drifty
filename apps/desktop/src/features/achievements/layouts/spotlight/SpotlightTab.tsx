import { Fragment, useCallback, useMemo, useRef } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS, type AchievementId } from "../../achievementCatalog";
import { AchievementMedal } from "../../AchievementMedal";
import { achievementDay, achievementName, formatAchievementDay, timesLabel } from "../../achievementCopy";
import { closestAchievements, remainingText } from "../../achievementProgress";
import type { AchievementLayoutTabProps } from "../types";
import { SpotlightStage } from "./SpotlightStage";
import "./spotlight-tab.css";

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

/** Bring the stage back into view when it has scrolled away. */
function scrollStageIntoView(node: HTMLElement) {
  const scroller = scrollContainer(node);
  const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const box = node.getBoundingClientRect();
  if (box.top >= view.top && box.bottom <= view.bottom) return;
  const contentTop = box.top + Number.parseFloat(getComputedStyle(node).paddingTop);
  const top = contentTop - view.top - STAGE_SCROLL_MARGIN_PX;
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  (scroller ?? window).scrollBy({ top, behavior });
}

function SpotlightLoading({ label }: { readonly label: string }) {
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

/** Insights › Achievements: the chosen achievement on a stage, then the whole collection by group. */
export function SpotlightTab({ model }: AchievementLayoutTabProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, items, byGroup, earnedCount, failedEmpty, selected, isNew, onOpenDay, onRetry } = model;
  const stageNode = useRef<HTMLElement>(null);
  const choose = useCallback((id: AchievementId) => {
    model.choose(id);
    if (stageNode.current) scrollStageIntoView(stageNode.current);
  }, [model]);
  const closest = useMemo(() => closestAchievements(items), [items]);

  if (model.loading) return <SpotlightLoading label={t("achievements.loading")} />;

  return (
    <>
      {failedEmpty ? (
        <div className="achievements-error" role="alert">
          <p>{t("achievements.error")}</p>
          <button type="button" className="app-btn app-btn--secondary" onClick={onRetry}>{t("achievements.retry")}</button>
        </div>
      ) : selected ? (
        <SpotlightStage item={selected} isNew={isNew(selected)} onOpenDay={onOpenDay} stageRef={stageNode} />
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
                        {isNew(item) ? <span className="achievement-tile__dot" aria-hidden="true" /> : null}
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
    </>
  );
}
