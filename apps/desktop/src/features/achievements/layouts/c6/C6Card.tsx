import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { ACHIEVEMENT_IDS } from "../../achievementCatalog";
import { achievementCondition, achievementName, medalName } from "../../achievementCopy";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { earnedDay, earnedLine, rarityLine, recordSentence } from "./c6Copy";
import { C6Medal } from "./C6Medal";
import "./c6-card.css";

/** Name, what it asked for, and how rare it is (or when it was earned when rarity is unknown). */
function CardStory({ item, titleId, eyebrow }: { readonly item: AchievementItem; readonly titleId: string; readonly eyebrow?: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const rarity = rarityLine(item, t, effectiveLanguage, "card");
  const day = eyebrow ? earnedDay(item, effectiveLanguage) : null;
  return (
    <div className="c6-card__story">
      {eyebrow ? <p className="c6-card__eyebrow">{day ? eyebrow + " · " + day : eyebrow}</p> : null}
      <h2 id={titleId} className="c6-card__title">{achievementName(item, t)}</h2>
      <p className="c6-card__condition">{achievementCondition(item, t)}</p>
      <p className="c6-card__line">
        {rarity ? (
          <>
            <span className="c6-card__tier" data-notable={rarity.notable ? "true" : undefined}>{rarity.tier}</span>
            <span className="c6-card__sep" aria-hidden="true"> · </span>
            {rarity.sentence}
          </>
        ) : earnedLine(item, t, effectiveLanguage)}
      </p>
      <dl className="c6-card__facts">
        <div className="c6-card__fact">
          <dt>{t("achievements.record.title")}</dt>
          <dd>{recordSentence(item, t, effectiveLanguage)}</dd>
        </div>
        <div className="c6-card__fact">
          <dt>{t("achievements.medal.title")}</dt>
          <dd>{medalName(item, t)}</dd>
        </div>
        {rarity ? (
          <div className="c6-card__fact">
            <dt>{t("achievements.rarity.title")}</dt>
            <dd><span className="c6-card__tier" data-notable={rarity.notable ? "true" : undefined}>{rarity.tier}</span></dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function Several({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const [index, setIndex] = useState(0);
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = ordered[Math.min(index, ordered.length - 1)];

  function go(next: number, focus: boolean) {
    const wrapped = (next + ordered.length) % ordered.length;
    setIndex(wrapped);
    if (focus) tabs.current[wrapped]?.focus();
  }

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="tablist"]')) return;
      event.preventDefault();
      setIndex((value) => (value + (event.key === "ArrowRight" ? 1 : -1) + ordered.length) % ordered.length);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ordered.length]);

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      go(index + (event.key === "ArrowRight" ? 1 : -1), true);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      go(event.key === "Home" ? 0 : ordered.length - 1, true);
    }
  }

  return (
    <>
      <p className="c6-card__context">{t("achievements.dialog.eyebrowMany", { count: ordered.length })}</p>
      <div className="c6-card__panel" role="tabpanel" id={base + "-panel"} aria-labelledby={base + "-tab-" + index}>
        <div className="c6-card__stage" key={"stage-" + current.definition.id}>
          <C6Medal item={current} floor className="c6-card__medal" />
        </div>
        <div className="c6-card__swap" key={"story-" + current.definition.id}>
          <CardStory item={current} titleId={titleId} />
        </div>
      </div>
      <div className="c6-thumbs" data-count={ordered.length} role="tablist" aria-label={t("achievements.dialog.eyebrowMany", { count: ordered.length })}>
        {ordered.map((item, position) => (
          <button
            key={item.definition.id}
            ref={(node) => { tabs.current[position] = node; }}
            type="button"
            role="tab"
            id={base + "-tab-" + position}
            className="c6-thumb"
            aria-selected={position === index}
            aria-controls={base + "-panel"}
            tabIndex={position === index ? 0 : -1}
            style={{ animationDelay: 420 + position * 40 + "ms" }}
            onClick={() => go(position, false)}
            onKeyDown={onTabKey}
          >
            <C6Medal item={item} small />
            <span className="c6-thumb__name">{achievementName(item, t)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const left = Math.max(0, ACHIEVEMENT_IDS.length - ordered.length);
  return (
    <>
      <div className="c6-card__intro">
        <p className="c6-card__context">{t("achievements.dialog.firstLookEyebrow")}</p>
        <h2 id={titleId} className="c6-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c6-card__condition">{t("achievements.dialog.firstLookBody")}</p>
      </div>
      <ul className="c6-found" data-count={ordered.length}>
        {ordered.map((item, index) => (
          <li key={item.definition.id} className="c6-found__item" style={{ animationDelay: 160 + index * 60 + "ms" }}>
            <C6Medal item={item} floor className="c6-found__medal" />
            <span className="c6-found__name">{achievementName(item, t)}</span>
          </li>
        ))}
      </ul>
      <p className="c6-found__left">
        {left > 0 ? t("achievements.c6.remaining", { count: left }) : t("achievements.c6.allFound", { count: ordered.length })}
      </p>
    </>
  );
}

/** The new-achievement card: one medal filling the card; several as a small gallery with thumbnails; the first look as a grid. */
export function C6Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  const root = useRef<HTMLDivElement>(null);

  // The sheet sits under the gallery's own edges, measured live; without a visible gallery it stays centred.
  useLayoutEffect(() => {
    const shell = root.current?.closest<HTMLElement>(".achievement-unlock");
    const gallery = document.querySelector<HTMLElement>('.achievements[data-layout="c6"] .c6-gallery');
    if (!shell || !gallery) return;
    const place = () => {
      const rect = gallery.getBoundingClientRect();
      if (rect.width < 320) {
        shell.style.removeProperty("--c6-sheet-left");
        shell.style.removeProperty("--c6-sheet-width");
        return;
      }
      shell.style.setProperty("--c6-sheet-left", rect.left + "px");
      shell.style.setProperty("--c6-sheet-width", rect.width + "px");
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(gallery);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);

  return (
    <div ref={root} className="c6-card" data-kind={showFirstLook ? "first-look" : others.length > 0 ? "several" : "single"}>
      {showFirstLook ? (
        <FirstLook ordered={ordered} titleId={titleId} />
      ) : others.length > 0 ? (
        <Several ordered={ordered} titleId={titleId} />
      ) : (
        <>
          <div className="c6-card__stage">
            <C6Medal item={lead} floor className="c6-card__medal" />
          </div>
          <CardStory item={lead} titleId={titleId} eyebrow={t("achievements.dialog.eyebrow")} />
        </>
      )}
      <div className="c6-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </div>
  );
}
