import { useCallback, useMemo, useRef } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS, type AchievementId } from "../../achievementCatalog";
import { achievementHoldings, almostThere } from "../../achievementCollection";
import { achievementName, timesLabel } from "../../achievementCopy";
import { progressShare } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C11Stage } from "./C11Stage";
import { C11Medal, C11TierSummary, nearLabel, nearLeft, shortDay } from "./c11Parts";
import "./c11-tab.css";

/** The nearest ancestor that scrolls, so "off screen" means out of the scroller's view rather than the window's. */
function scrollerTop(node: HTMLElement): number {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent.getBoundingClientRect().top;
  }
  return 0;
}

function C11Loading({ label }: { readonly label: string }) {
  return (
    <div className="c11 c11--loading">
      <div className="c11-top">
        <div className="editorial-panel c11-stage c11-stage--skeleton" aria-hidden="true">
          <div className="c11-stage__inner">
            <div className="c11-stage__jewel"><span className="c11-medal c11-stage__medal c11-skeleton c11-skeleton--medal" /></div>
            <div className="c11-stage__text">
              <span className="c11-skeleton c11-skeleton--title" />
              <span className="c11-skeleton c11-skeleton--line" />
              <span className="c11-skeleton c11-skeleton--line c11-skeleton--short" />
            </div>
            <div className="c11-stage__zone" />
          </div>
        </div>
      </div>
      <p className="c11-collection__count c11-collection__count--quiet" role="status">{label}</p>
      <div className="c11-shelves" aria-hidden="true">
        {ACHIEVEMENT_GROUPS.map((group) => (
          <div key={group} className="c11-shelf">
            <div className="c11-shelf__head"><span className="c11-skeleton c11-skeleton--label" /></div>
            <div className="c11-shelf__row">
              {[0, 1, 2].map((slot) => (
                <span key={slot} className="c11-tile c11-tile--skeleton"><span className="c11-medal c11-tile__medal c11-skeleton c11-skeleton--medal" /></span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A tile's quiet second line: how many times for a repeatable, the day for a one-off. */
function TileStatus({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const { earned, definition } = item;
  if (earned) {
    return <span className="c11-tile__status">{definition.repeatable ? timesLabel(earned.count, t) : shortDay(earned.firstDay, effectiveLanguage)}</span>;
  }
  const share = definition.hidden ? 0 : progressShare(item);
  return share > 0 ? <span className="c11-bar c11-tile__bar" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span> : null;
}

/**
 * Insights › Achievements: the chosen achievement (by default the latest earned)
 * on a stage at the top, the goals closest to done beside it, then the
 * collection as four shelves.
 */
export function C11Tab({ model }: AchievementLayoutTabProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, items, byGroup, earnedCount, failedEmpty, selected, choose, isNew, onOpenDay, onRetry } = model;
  const near = useMemo(() => almostThere(items, { limit: 3 }), [items]);
  const holdings = useMemo(() => achievementHoldings(items), [items]);
  const stageRef = useRef<HTMLElement>(null);
  const selectedId = selected?.definition.id;

  const bring = useCallback((id: AchievementId) => {
    choose(id);
    const stage = stageRef.current;
    if (!stage || stage.getBoundingClientRect().top >= scrollerTop(stage)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stage.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [choose]);

  if (model.loading) return <C11Loading label={t("achievements.loading")} />;

  return (
    <div className="c11">
      <div className="c11-top">
        {failedEmpty ? (
          <aside className="editorial-panel c11-stage c11-stage--error" role="alert">
            <p>{t("achievements.error")}</p>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </aside>
        ) : selected ? (
          <C11Stage ref={stageRef} item={selected} isNew={isNew(selected)} onOpenDay={onOpenDay} />
        ) : null}

        <section className="c11-near" data-almost-there="" aria-labelledby="c11-near-title">
          <h2 id="c11-near-title" className="c11-near__title">{t("achievements.near.title")}</h2>
          {near.length > 0 ? (
            <ul className="c11-near__list">
              {near.map((entry) => (
                <li key={entry.item.definition.id} className="c11-near__entry">
                  <button
                    type="button"
                    className="c11-near__item"
                    data-almost-there-id={entry.item.definition.id}
                    data-current={entry.item.definition.id === selectedId ? "true" : undefined}
                    aria-label={nearLabel(entry, t, effectiveLanguage)}
                    onClick={() => bring(entry.item.definition.id)}
                  >
                    <C11Medal item={entry.item} small className="c11-medal c11-near__medal" />
                    <span className="c11-near__text">
                      <span className="c11-near__name">{achievementName(entry.item, t)}</span>
                      <span className="c11-near__left">{nearLeft(entry, t, effectiveLanguage)}</span>
                      <span className="c11-bar c11-near__bar" aria-hidden="true"><span style={{ width: Math.round(entry.share * 100) + "%" }} /></span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="c11-near__done">{t("achievements.c11.nearDone")}</p>
          )}
        </section>
      </div>

      <div className="c11-collection">
        <div className="c11-collection__head">
          <p className="c11-collection__count">{t("achievements.summary", { earned: earnedCount, total: items.length })}</p>
          {holdings ? <C11TierSummary holdings={holdings} className="c11-tiers" /> : null}
          {status === "error" && !failedEmpty ? (
            <p className="c11-collection__notice" role="alert">
              <span>{t("achievements.error")}</span>
              <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
            </p>
          ) : null}
        </div>

        <div className="c11-shelves">
          {byGroup.map(({ group, items: groupItems }) => (
            <section key={group} className="c11-shelf" aria-labelledby={"c11-shelf-" + group}>
              <div className="c11-shelf__head">
                <h2 id={"c11-shelf-" + group} className="c11-shelf__title">{t(("achievements.group." + group) as TranslationKey)}</h2>
                <span className="c11-shelf__count">{groupItems.filter((item) => item.earned).length}/{groupItems.length}</span>
              </div>
              <div className="c11-shelf__row">
                {groupItems.map((item) => {
                  const name = achievementName(item, t);
                  return (
                    <button
                      key={item.definition.id}
                      type="button"
                      className="c11-tile"
                      data-state={item.earned ? "earned" : "locked"}
                      aria-pressed={item.definition.id === selectedId}
                      aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
                      onClick={() => bring(item.definition.id)}
                    >
                      <C11Medal item={item} className="c11-medal c11-tile__medal" />
                      <span className="c11-tile__name">
                        {isNew(item) ? <span className="c11-dot" aria-hidden="true" /> : null}
                        {name}
                      </span>
                      <TileStatus item={item} />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <p className="c11-footnote" role={status === "loading" ? "status" : undefined}>
        {status === "loading" ? t("achievements.loading") : t("achievements.note")}
      </p>
    </div>
  );
}
