import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS, type AchievementId } from "../../achievementCatalog";
import { AchievementMedal } from "../../AchievementMedal";
import { achievementCondition, achievementName, shownRarity } from "../../achievementCopy";
import { closestAchievements, remainingText } from "../../achievementProgress";
import type { AchievementLayoutTabProps } from "../types";
import { C2Detail } from "./C2Detail";
import { C2Rarity, C2Status, prefersReducedMotion } from "./c2Parts";
import "./c2-parts.css";
import "./c2-tab.css";

const DETAIL_ID = "c2-achievement-detail";
const SLIDE_MS = 200;
const REVEAL_MARGIN_PX = 16;

function scrollContainer(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

function viewOf(scroller: HTMLElement | null): { readonly top: number; readonly bottom: number } {
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  }
  return { top: 0, bottom: window.innerHeight };
}

function scrollByAmount(scroller: HTMLElement | null, top: number, behavior: ScrollBehavior) {
  if (scroller) scroller.scrollBy({ top, behavior });
  else window.scrollBy({ top, behavior });
}

function C2Loading({ label }: { readonly label: string }) {
  return (
    <div className="c2-loading">
      <p className="c2-loading__label" role="status">{label}</p>
      {ACHIEVEMENT_GROUPS.slice(0, 2).map((group) => (
        <div key={group} className="c2-loading__group" aria-hidden="true">
          <span className="c2-loading__head" />
          {[0, 1, 2].map((row) => (
            <span key={row} className="c2-loading__row">
              <span className="c2-loading__medal" />
              <span className="c2-loading__lines"><span /><span /></span>
              <span className="c2-loading__status" />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Chevron() {
  return (
    <svg className="c2-row__chevron" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function C2Tab({ model }: AchievementLayoutTabProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, items, byGroup, earnedCount, failedEmpty, selected, isNew, onOpenDay, onRetry } = model;
  const [collapsed, setCollapsed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const detailNode = useRef<HTMLElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const pending = useRef<{ readonly tops: Map<string, number>; readonly anchor: string } | null>(null);
  const closest = useMemo(() => closestAchievements(items), [items]);
  const hasRarity = items.some((item) => shownRarity(item) !== null);
  const selectedId = selected?.definition.id;
  const openId = collapsed ? null : selectedId ?? null;

  const register = useCallback((key: string) => (node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  }, []);

  const choose = useCallback((id: AchievementId) => {
    const tops = new Map<string, number>();
    for (const [key, node] of nodes.current) tops.set(key, node.getBoundingClientRect().top);
    pending.current = { tops, anchor: id };
    if (id === selectedId) {
      setCollapsed((value) => !value);
    } else {
      setCollapsed(false);
      model.choose(id);
    }
  }, [model, selectedId]);

  useLayoutEffect(() => {
    const change = pending.current;
    pending.current = null;
    const container = root.current;
    if (!change || !container) return;
    const reduced = prefersReducedMotion();
    const scroller = scrollContainer(container);
    const anchor = nodes.current.get(change.anchor);
    const anchorBefore = change.tops.get(change.anchor);
    if (anchor && anchorBefore !== undefined) {
      const drift = anchor.getBoundingClientRect().top - anchorBefore;
      if (Math.abs(drift) > 0.5) scrollByAmount(scroller, drift, "instant");
    }
    if (!reduced) {
      for (const [key, node] of nodes.current) {
        if (key === change.anchor || typeof node.animate !== "function") continue;
        const before = change.tops.get(key);
        if (before === undefined) continue;
        const delta = before - node.getBoundingClientRect().top;
        if (Math.abs(delta) < 0.5) continue;
        node.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: "cubic-bezier(0.25, 1, 0.5, 1)" });
      }
    }
    const detail = detailNode.current;
    if (detail && anchor) {
      const view = viewOf(scroller);
      const overflow = detail.getBoundingClientRect().bottom + REVEAL_MARGIN_PX - view.bottom;
      const room = anchor.getBoundingClientRect().top - view.top - REVEAL_MARGIN_PX * 4;
      const by = Math.min(overflow, room);
      if (by > 0) scrollByAmount(scroller, by, reduced ? "instant" : "smooth");
    }
  }, [openId]);

  const onListKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = [...(root.current?.querySelectorAll<HTMLButtonElement>(".c2-row") ?? [])];
    const at = rows.findIndex((row) => row === document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    const target = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
    rows[target]?.focus();
  }, []);

  if (model.loading) return <C2Loading label={t("achievements.loading")} />;

  return (
    <div ref={root} className="c2">
      <div className="c2-frame" data-rarity={hasRarity ? "shown" : "none"}>
      <div className="c2-top">
        <div className="c2-top__summary">
          <p className="c2-top__count">{t("achievements.summary", { earned: earnedCount, total: items.length })}</p>
          {status === "error" && !failedEmpty ? (
            <p className="c2-top__notice" role="alert">
              <span>{t("achievements.error")}</span>
              <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
            </p>
          ) : closest.length > 0 ? (
            <p className="c2-top__near">
              <span>{t("achievements.near.title")}</span>
              {closest.map((item) => (
                <button key={item.definition.id} type="button" className="c2-top__near-item" onClick={() => choose(item.definition.id)}>
                  <span className="c2-top__near-name">{achievementName(item, t)}</span> {remainingText(item, t, effectiveLanguage)}
                </button>
              ))}
            </p>
          ) : null}
        </div>
      </div>

      {failedEmpty ? (
        <div className="c2-error" role="alert">
          <p>{t("achievements.error")}</p>
          <button type="button" className="app-btn app-btn--secondary" onClick={onRetry}>{t("achievements.retry")}</button>
        </div>
      ) : null}

      <div className="c2-list" onKeyDown={onListKeyDown}>
        {byGroup.map(({ group, items: groupItems }) => (
          <section key={group} className="c2-group" aria-labelledby={"c2-group-" + group}>
            <div ref={register("group:" + group)} className="c2-group__head">
              <div className="c2-group__label">
                <h2 id={"c2-group-" + group} className="c2-group__title">{t(("achievements.group." + group) as TranslationKey)}</h2>
                <span className="c2-group__count">{groupItems.filter((item) => item.earned).length}/{groupItems.length}</span>
                <span className="c2-group__ticks" aria-hidden="true">
                  {groupItems.map((item) => <span key={item.definition.id} data-earned={item.earned ? "true" : undefined} />)}
                </span>
              </div>
              {hasRarity ? <span className="c2-group__column">{t("achievements.c2.rarityHead")}</span> : null}
            </div>
            {groupItems.map((item) => {
              const id = item.definition.id;
              const name = achievementName(item, t);
              const open = id === openId;
              return (
                <Fragment key={id}>
                  <button
                    ref={register(id)}
                    type="button"
                    className="c2-row"
                    data-state={item.earned ? "earned" : "locked"}
                    data-open={open ? "true" : undefined}
                    aria-pressed={id === selectedId}
                    aria-expanded={open}
                    aria-controls={open ? DETAIL_ID : undefined}
                    aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
                    onClick={() => choose(id)}
                  >
                    <span className="c2-row__medal"><AchievementMedal item={item} /></span>
                    <span className="c2-row__text">
                      <span className="c2-row__title">
                        <span className="c2-row__name">{name}</span>
                        {isNew(item) ? <span className="c2-row__new"><span className="c2-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
                      </span>
                      <span className="c2-row__condition">{achievementCondition(item, t)}</span>
                    </span>
                    <C2Status item={item} t={t} language={effectiveLanguage} />
                    {hasRarity ? <C2Rarity item={item} t={t} language={effectiveLanguage} /> : null}
                    <Chevron />
                  </button>
                  {open ? <C2Detail key={id} item={item} id={DETAIL_ID} onOpenDay={onOpenDay} detailRef={detailNode} /> : null}
                </Fragment>
              );
            })}
          </section>
        ))}
      </div>

      <p ref={register("footnote")} className="c2-footnote" role={status === "loading" ? "status" : undefined}>
        {status === "loading" ? t("achievements.loading") : t("achievements.note")}
      </p>
      </div>
    </div>
  );
}
