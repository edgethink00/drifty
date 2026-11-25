import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ModalPresence } from "../../../../components/ModalPresence";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import type { AchievementId } from "../../achievementCatalog";
import type { AlmostThereEntry } from "../../achievementCollection";
import { achievementCondition, achievementName, timesLabel } from "../../achievementCopy";
import { progressNote } from "../../achievementProgress";
import { achievementRowParts, type EarnedRowOrder } from "../../achievementRows";
import { isAchievementDesignReview, useAchievementHoverMotion, useAchievementListFrame, useAchievementReviewState, useActiveAchievementOpenStyle } from "../../achievementDesignReview";
import { shownRarity } from "../../achievementCopy";
import { SettingsSelect } from "../../../settings/SettingsSelect";
import "../../../dashboard/timeline-zoom.css";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C15Medal } from "./C15Medal";
import { C15Open } from "./C15Open";
import { C15Popup } from "./C15Popup";
import { medalTint, rowFact } from "./c15Copy";

const SKELETON_ROWS = 5;

function Chevron() {
  return (
    <svg className="c15-row__chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type RowProps = {
  readonly item: AchievementItem;
  /** Set when the row leads the list as a goal under way. */
  readonly entry?: AlmostThereEntry;
  readonly open: boolean;
  /** The row opens the achievement's popup instead of expanding in place. */
  readonly popup?: boolean;
  readonly isNew: boolean;
  /** The medal leans toward the pointer while the row is pointed at. */
  readonly lean?: boolean;
  readonly onToggle: (id: AchievementId) => void;
  readonly onOpenDay: (day: string) => void;
};

/** Where the pointer is from the medal's centre, eased into -1 to 1 so a far pointer leans it fully but never further. */
function leanToward(event: ReactPointerEvent<HTMLButtonElement>) {
  const medal = event.currentTarget.querySelector<HTMLElement>(".c15-row__medal");
  if (!medal) return;
  const box = medal.getBoundingClientRect();
  medal.style.setProperty("--c15-lean-x", Math.tanh((event.clientX - (box.left + box.width / 2)) / 240).toFixed(3));
  medal.style.setProperty("--c15-lean-y", Math.tanh((event.clientY - (box.top + box.height / 2)) / 60).toFixed(3));
}

function leanBack(event: ReactPointerEvent<HTMLButtonElement>) {
  const medal = event.currentTarget.querySelector<HTMLElement>(".c15-row__medal");
  medal?.style.removeProperty("--c15-lean-x");
  medal?.style.removeProperty("--c15-lean-y");
}

/** One achievement: the big medal, name over condition, one strong fact on the right; opens in place. */
function Row({ item, entry, open, popup = false, isNew, lean = false, onToggle, onOpenDay }: RowProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const id = definition.id;
  const name = achievementName(item, t);
  const concealed = definition.hidden && !earned;
  const fact = rowFact(item, t, effectiveLanguage);
  // With rarity on the right edge, a repeat's count moves beside the name so it is never lost.
  const times = earned && definition.repeatable && earned.count > 1 && fact?.kind === "rarity" ? timesLabel(earned.count, t) : null;
  const left = entry ? progressNote(item, t, effectiveLanguage) : null;
  const openId = "c15-open-" + id;
  return (
    <li
      className="c15-item"
      data-state={earned ? "earned" : "locked"}
      data-open={open ? "true" : undefined}
      data-almost-there-id={entry ? id : undefined}
    >
      <button
        type="button"
        className="c15-row"
        aria-expanded={popup ? undefined : open}
        aria-haspopup={popup ? "dialog" : undefined}
        aria-controls={open ? openId : undefined}
        aria-label={t(earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
        onClick={() => onToggle(id)}
        onPointerMove={lean ? leanToward : undefined}
        onPointerLeave={lean ? leanBack : undefined}
      >
        <C15Medal item={item} className="c15-medal c15-row__medal" />
        <span className="c15-row__text">
          <span className="c15-row__line">
            <span className="c15-row__name">{name}</span>
            {times ? <span className="c15-row__times">{times}</span> : null}
            {isNew ? <span className="c15-row__new"><span className="c15-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
          </span>
          <span className="c15-row__condition">
            <span className="c15-row__meaning">{achievementCondition(item, t)}</span>
            {concealed ? null : <span className="c15-row__group">{t(("achievements.group." + definition.group) as TranslationKey)}</span>}
          </span>
          {/* Under way: name and condition read as in every row, the bar comes after them. */}
          {entry ? (
            <span className="c15-row__progress">
              <span className="c15-bar" aria-hidden="true" style={medalTint(id)}><span style={{ width: Math.round(entry.share * 100) + "%" }} /></span>
              <span className="c15-row__ends">
                <span className="c15-row__share">{t("achievements.c15.percent", { percent: Math.round(entry.share * 100) })}</span>
                {left ? <span className="c15-row__left">{left}</span> : null}
              </span>
            </span>
          ) : null}
        </span>
        <span className="c15-row__fact" data-kind={fact?.kind} data-notable={fact?.notable ? "true" : undefined}>
          {fact ? (
            <>
              <span className="c15-row__figure">{fact.figure}</span>
              <span className="c15-row__word">{fact.word}</span>
            </>
          ) : null}
        </span>
        <Chevron />
      </button>
      {open ? <C15Open item={item} id={openId} headingId={openId + "-name"} isNew={isNew} onOpenDay={onOpenDay} /> : null}
    </li>
  );
}

function C15Loading({ label }: { readonly label: string }) {
  return (
    <div className="c15 c15--loading">
      <div className="c15-summary">
        <p className="c15-summary__count" role="status">{label}</p>
      </div>
      <ol className="c15-list" aria-hidden="true">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <li key={index} className="c15-item">
            <span className="c15-row c15-row--skeleton">
              <span className="c15-medal c15-row__medal"><span className="c15-skeleton c15-skeleton--medal" /></span>
              <span className="c15-row__text">
                <span className="c15-skeleton c15-skeleton--name" />
                <span className="c15-skeleton c15-skeleton--line" />
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Insights › Achievements as big-medal rows in two parts: earned, the
 * longest records first, then not yet, led by the goals under way with their
 * progress (furthest along first) and ending with the hidden ones.
 */
export function C15Tab({ model }: AchievementLayoutTabProps) {
  const { t } = useLocalization();
  const { status, items, failedEmpty, choose, isNew, onOpenDay, onRetry } = model;
  // Dev review only for now: a sort menu over the earned part, to judge whether one earns its place.
  const sortMenu = useAchievementReviewState().sortMenu && isAchievementDesignReview();
  const [order, setOrder] = useState<EarnedRowOrder>("most");
  const earnedOrder = sortMenu ? order : "most";
  const parts = useMemo(() => achievementRowParts(items, { almost: Infinity, earned: earnedOrder }), [items, earnedOrder]);
  const hasRarity = useMemo(() => items.some((item) => shownRarity(item) !== null), [items]);
  const [openId, setOpenId] = useState<AchievementId | null>(null);
  const [popupId, setPopupId] = useState<AchievementId | null>(null);
  const openStyle = useActiveAchievementOpenStyle();
  const frame = useAchievementListFrame();
  const hover = useAchievementHoverMotion();
  const popup = openStyle === "popup" || openStyle === "stage";

  if (model.loading) return <C15Loading label={t("achievements.loading")} />;

  const toggle = (id: AchievementId) => {
    if (popup) setPopupId(id);
    else setOpenId((current) => (current === id ? null : id));
    choose(id);
  };
  const popupItem = popup && popupId ? items.find((item) => item.definition.id === popupId) ?? null : null;
  const row = (item: AchievementItem, entry?: AlmostThereEntry) => (
    <Row
      key={item.definition.id}
      item={item}
      entry={entry}
      open={!popup && openId === item.definition.id}
      popup={popup}
      isNew={isNew(item)}
      lean={hover === "lean"}
      onToggle={toggle}
      onOpenDay={onOpenDay}
    />
  );
  const later = [...parts.notYet, ...parts.hidden];
  const anyLater = parts.almost.length + later.length > 0;

  return (
    <div className="c15" data-hover={hover} data-boxed={frame === "parts" ? "" : undefined} data-cards={frame === "cards" ? "fill" : frame === "cardsLine" ? "line" : undefined}>
      {failedEmpty ? (
        <div className="c15-failed" role="alert">
          <p>{t("achievements.error")}</p>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
        </div>
      ) : status === "error" ? (
        <div className="c15-head">
          <p className="c15-notice" role="alert">
            <span>{t("achievements.error")}</span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </p>
        </div>
      ) : null}

      {parts.earned.length > 0 ? (
        <section className="c15-part" aria-labelledby="c15-part-earned">
          <div className="c15-part__head">
            <h2 id="c15-part-earned" className="c15-part__label">{t("achievements.c15.part.earned")}</h2>
            {sortMenu && parts.earned.length > 1 ? (
              // The app's compact menu capsule, the one the calendar's time zoom uses.
              <div className="seg timeline-zoom c15-sort" role="group" aria-label={t("achievements.c15.sort.label")}>
                <SettingsSelect<EarnedRowOrder>
                  ariaLabel={t("achievements.c15.sort.label")}
                  className="timeline-zoom__menu"
                  value={order}
                  options={[
                    { value: "most", label: t("achievements.c15.sort.most") },
                    { value: "recent", label: t("achievements.c15.sort.recent") },
                    ...(hasRarity ? [{ value: "rarest" as const, label: t("achievements.c15.sort.rarest") }] : []),
                  ]}
                  onChange={setOrder}
                  placement="below"
                  menuSize="content"
                />
              </div>
            ) : null}
          </div>
          <ol className="c15-list">{parts.earned.map((item) => row(item))}</ol>
        </section>
      ) : null}

      {/* Not yet: those under way lead, furthest along first, with their bars; hidden ones last. */}
      {anyLater ? (
        <section className="c15-part" aria-labelledby="c15-part-later">
          <h2 id="c15-part-later" className="c15-part__label">{t("achievements.c15.part.notYet")}</h2>
          <ol className="c15-list">
            {parts.almost.map((entry) => row(entry.item, entry))}
            {later.map((item) => row(item))}
          </ol>
        </section>
      ) : null}

      {/* Only while the latest days are still being worked out; otherwise the list ends with its last row. */}
      {status === "loading" ? <p className="c15-footnote" role="status">{t("achievements.loading")}</p> : null}
      <ModalPresence>
        {popupItem ? <C15Popup item={popupItem} look={openStyle === "stage" ? "stage" : "side"} onClose={() => setPopupId(null)} onOpenDay={onOpenDay} /> : null}
      </ModalPresence>
    </div>
  );
}
