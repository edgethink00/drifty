import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS, type AchievementId } from "../../achievementCatalog";
import { achievementHoldings, almostThere, type AlmostThereEntry } from "../../achievementCollection";
import { achievementCondition, achievementDay, achievementName, formatAchievementDay } from "../../achievementCopy";
import { progressShare, progressText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C8Sheet } from "./C8Sheet";
import { C8Medal, Multiplier, TierSummary, featuredMedals, goalLeft } from "./c8Parts";

type Open = (id: AchievementId, opener: HTMLElement) => void;

function Loading({ label }: { readonly label: string }) {
  return (
    <div className="c8 c8--loading">
      <div className="c8-content">
      <div className="editorial-panel c8-profile">
        <div className="c8-held">
          <span className="c8-skeleton c8-skeleton--count" aria-hidden="true" />
          <span className="c8-skeleton c8-skeleton--bar" aria-hidden="true" />
          <p className="c8-held__label" role="status">{label}</p>
        </div>
        <ul className="c8-tiers" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((slot) => <li key={slot} className="c8-tiers__item"><span className="c8-skeleton c8-skeleton--tier" /></li>)}
        </ul>
        <ul className="c8-featured" aria-hidden="true">
          {[0, 1, 2].map((slot) => (
            <li key={slot} className="c8-featured__item">
              <span className="c8-medal c8-featured__medal c8-skeleton c8-skeleton--medal" />
              <span className="c8-skeleton c8-skeleton--name" />
            </li>
          ))}
        </ul>
      </div>
      <div className="c8-collection" aria-hidden="true">
        {ACHIEVEMENT_GROUPS.map((group) => (
          <div key={group} className="c8-group">
            <span className="c8-skeleton c8-skeleton--head" />
            <div className="c8-grid">
              {[0, 1, 2].map((slot) => (
                <span key={slot} className="c8-entry c8-entry--skeleton">
                  <span className="c8-medal c8-skeleton c8-skeleton--medal" />
                  <span className="c8-entry__text">
                    <span className="c8-skeleton c8-skeleton--line" />
                    <span className="c8-skeleton c8-skeleton--short" />
                  </span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

function Profile({ items, earnedCount, onOpen }: { readonly items: readonly AchievementItem[]; readonly earnedCount: number; readonly onOpen: Open }) {
  const { t } = useLocalization();
  const holdings = useMemo(() => achievementHoldings(items), [items]);
  const featured = useMemo(() => featuredMedals(items, holdings), [items, holdings]);
  return (
    <section className="editorial-panel c8-profile" aria-label={t("achievements.summary", { earned: earnedCount, total: items.length })}>
      <div className="c8-held">
        <p className="c8-held__count">
          <span className="c8-held__n">{earnedCount}</span>
          <span className="c8-held__of">/ {items.length}</span>
        </p>
        <span className="c8-bar c8-held__bar" aria-hidden="true"><span style={{ width: Math.round((earnedCount / Math.max(1, items.length)) * 100) + "%" }} /></span>
        <p className="c8-held__label">{t("achievements.c8.collected")}</p>
      </div>
      {holdings ? <TierSummary holdings={holdings} t={t} /> : null}
      {featured.length > 0 ? (
        <ul className="c8-featured" aria-label={t("achievements.c8.featured")}>
          {featured.map((item) => {
            const name = achievementName(item, t);
            return (
              <li key={item.definition.id}>
                <button
                  type="button"
                  className="c8-featured__item"
                  data-c8-opener=""
                  aria-label={t("achievements.c8.openRecord", { name })}
                  onClick={(event) => onOpen(item.definition.id, event.currentTarget)}
                >
                  <span className="c8-medal-wrap">
                    <C8Medal item={item} className="c8-medal c8-featured__medal" />
                    <Multiplier item={item} t={t} className="c8-x c8-x--medal" />
                  </span>
                  <span className="c8-featured__name">{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function AlmostThere({ entries, onOpen }: { readonly entries: readonly AlmostThereEntry[]; readonly onOpen: Open }) {
  const { effectiveLanguage, t } = useLocalization();
  const titleId = useId();
  return (
    <section className="c8-near" data-almost-there aria-labelledby={titleId}>
      <h2 id={titleId} className="c8-section-title">{t("achievements.near.title")}</h2>
      <div className="c8-near__row">
        {entries.map((entry) => {
          const { item, kind, share } = entry;
          const name = achievementName(item, t);
          const left = goalLeft(entry, t, effectiveLanguage);
          return (
            <button
              key={item.definition.id}
              type="button"
              className="c8-near__card"
              data-c8-opener=""
              data-almost-there-id={item.definition.id}
              data-kind={kind}
              aria-label={t("achievements.c8.nearLabel", { name, left })}
              onClick={(event) => onOpen(item.definition.id, event.currentTarget)}
            >
              <C8Medal item={item} className="c8-medal c8-near__medal" />
              <span className="c8-near__text">
                <span className="c8-near__share">{t("achievements.c8.complete", { percent: Math.floor(share * 100) })}</span>
                <span className="c8-near__name">{name}</span>
                <span className="c8-near__left">{left}</span>
                <span className="c8-bar c8-near__bar" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Entry({ item, pressed, fresh, onOpen }: { readonly item: AchievementItem; readonly pressed: boolean; readonly fresh: boolean; readonly onOpen: Open }) {
  const { effectiveLanguage, t } = useLocalization();
  const name = achievementName(item, t);
  const day = achievementDay(item);
  const progress = item.earned || item.definition.hidden ? null : progressText(item, t, effectiveLanguage);
  return (
    <button
      type="button"
      className="c8-entry"
      data-c8-opener=""
      data-state={item.earned ? "earned" : "locked"}
      aria-pressed={pressed}
      aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
      onClick={(event) => onOpen(item.definition.id, event.currentTarget)}
    >
      <span className="c8-medal-wrap">
        <C8Medal item={item} className="c8-medal c8-entry__medal" />
        <Multiplier item={item} t={t} className="c8-x c8-x--medal" />
      </span>
      <span className="c8-entry__text">
        <span className="c8-entry__name">
          {fresh ? <span className="c8-dot" aria-hidden="true" /> : null}
          {name}
        </span>
        <span className="c8-entry__meaning" title={achievementCondition(item, t)}>{achievementCondition(item, t)}</span>
        {day ? (
          <span className="c8-entry__status">{formatAchievementDay(day, effectiveLanguage)}</span>
        ) : progress ? (
          <span className="c8-entry__status c8-entry__status--progress">
            <span>{progress}</span>
            <span className="c8-bar c8-entry__bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
          </span>
        ) : (
          <span className="c8-entry__status c8-entry__status--quiet">{t("achievements.c8.notYet")}</span>
        )}
      </span>
    </button>
  );
}

/** Insights › Achievements: a profile strip, what is almost done, the collection, and a record sheet over it. */
export function C8Tab({ model }: AchievementLayoutTabProps) {
  const { t } = useLocalization();
  const { status, items, byGroup, earnedCount, selected, choose, isNew, onOpenDay, onRetry } = model;
  const near = useMemo(() => almostThere(items, { limit: 3, medals: true }), [items]);
  const [openId, setOpenId] = useState<AchievementId | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const sheetTitleId = useId();
  const selectedId = selected?.definition.id;
  const open = openId !== null && openId === selectedId && selected !== undefined;

  const onOpen = useCallback<Open>((id, opener) => {
    openerRef.current = opener;
    choose(id);
    setOpenId(id);
  }, [choose]);
  const close = useCallback((restore: boolean) => {
    restoreFocus.current = restore;
    setOpenId(null);
  }, []);
  const dismiss = useCallback(() => close(true), [close]);

  // Focus moves into the sheet as it opens or changes; Escape and the close button hand it back to the opener.
  useEffect(() => {
    if (open) {
      closeRef.current?.focus({ preventScroll: true });
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      openerRef.current?.focus({ preventScroll: true });
    }
  }, [open, openId]);

  // The sheet ends a margin above the tab viewport's bottom wherever it sits, so its edge stays in view and the record scrolls inside.
  useEffect(() => {
    const layer = sheetRef.current;
    const sheet = layer?.querySelector<HTMLElement>(".c8-sheet");
    if (!open || !layer || !sheet) return undefined;
    let scroller = layer.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const viewport = scroller ?? document.documentElement;
    const fit = () => {
      const style = getComputedStyle(sheet);
      const bounds = viewport.getBoundingClientRect();
      const stickyTop = bounds.top + (parseFloat(style.top) || 0);
      const top = Math.max(layer.getBoundingClientRect().top + (parseFloat(style.marginTop) || 0), stickyTop);
      const room = Math.min(bounds.bottom, window.innerHeight) - top - (parseFloat(style.top) || 0);
      if (room > 0) sheet.style.setProperty("--c8-sheet-max", Math.max(240, Math.round(room)) + "px");
    };
    fit();
    viewport.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    return () => {
      viewport.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [open, openId]);

  // A light-dismiss sheet: Escape closes it, and so does a press anywhere but the sheet or another entry.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close(true);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (sheetRef.current?.contains(target) || target?.closest("[data-c8-opener]")) return;
      close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  if (model.loading) return <Loading label={t("achievements.loading")} />;

  return (
    <div className="c8" data-sheet={open ? "open" : undefined}>
      <div className="c8-content">
        {status === "error" ? (
          <p className="c8-notice" role="alert">
            <span>{t("achievements.error")}</span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </p>
        ) : null}

        <Profile items={items} earnedCount={earnedCount} onOpen={onOpen} />

        <div className="c8-main">
        {near.length > 0 ? <AlmostThere entries={near} onOpen={onOpen} /> : null}

        <div className="c8-collection">
          {byGroup.map(({ group, items: groupItems }) => {
            const headingId = "c8-group-" + group;
            return (
              <section key={group} className="c8-group" aria-labelledby={headingId}>
                <div className="c8-group__head">
                  <h2 id={headingId} className="c8-section-title">{t(("achievements.group." + group) as TranslationKey)}</h2>
                  <span className="c8-group__count">{groupItems.filter((item) => item.earned).length}/{groupItems.length}</span>
                </div>
                <div className="c8-grid">
                  {groupItems.map((item) => (
                    <Entry key={item.definition.id} item={item} pressed={item.definition.id === selectedId} fresh={isNew(item)} onOpen={onOpen} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <p className="c8-footnote" role={status === "loading" ? "status" : undefined}>
          {status === "loading" ? t("achievements.loading") : t("achievements.note")}
        </p>
        </div>

        {open && selected ? <div className="c8-scrim" aria-hidden="true" /> : null}
        {open && selected ? (
          <div ref={sheetRef} className="c8-layer">
            <C8Sheet ref={closeRef} item={selected} isNew={isNew(selected)} titleId={sheetTitleId} onOpenDay={onOpenDay} onClose={dismiss} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
