import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { shiftIsoDate, type ActivitySegment, type ClassificationOptions } from "@drifty/domain";
import type { CompactHistoryLoad, CompactHistoryRange } from "../dashboard/compactHistoryCache";
import { formatLocalizedCompactDurationFromSeconds, getLogicalDayRange } from "../../lib/formatting";
import { mergeActivitySegments } from "../../lib/activitySegments";
import { useLocalization } from "../localization/LocalizationContext";
import { buildFocusCalendar, focusCalendarWindow, type FocusCalendarDay, type FocusCalendarVariant } from "./focusCalendar";

/** Primer/GitHub hover delay: wait before the first tip, then follow adjacent cells immediately. */
export const FOCUS_CALENDAR_TOOLTIP_DELAY_MS = 400;

const CALENDAR_TOOLTIP_VIEWPORT_PADDING = 12;

/** Keep a cell-anchored tip inside the window and slide the caret back to the square. */
export function alignCalendarTooltip(anchorX: number, width: number, viewportWidth: number, padding = CALENDAR_TOOLTIP_VIEWPORT_PADDING) {
  const half = Math.max(width / 2, 0);
  const minCenter = padding + half;
  const maxCenter = viewportWidth - padding - half;
  const left = width >= viewportWidth - padding * 2
    ? viewportWidth / 2
    : Math.min(Math.max(anchorX, minCenter), Math.max(minCenter, maxCenter));
  const maxShift = Math.max(half - 10, 0);
  return {
    left,
    caretShift: Math.max(-maxShift, Math.min(maxShift, anchorX - left)),
  };
}

type CalendarTooltip = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly placement: "above" | "below";
};

export type FocusCalendarCardProps = {
  readonly endDay: string;
  readonly endDayIsInProgress?: boolean;
  readonly startOfDayMinutes: number;
  readonly recentSegments: ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly loadHistory: (range: CompactHistoryRange) => Promise<CompactHistoryLoad>;
  readonly variant?: FocusCalendarVariant;
};

export function FocusCalendarCard({ endDay, endDayIsInProgress = false, startOfDayMinutes, recentSegments, classificationOptions, loadHistory, variant: suppliedVariant }: FocusCalendarCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  // Five months is the selected default; explicit parameters retain review alternatives.
  const requested = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("focusCalendar");
  const variant: FocusCalendarVariant = suppliedVariant ?? (requested === "year" || requested === "half-compact" || requested === "quarter" ? requested : "half");
  const year = endDay.slice(0, 4);
  const { startDay, gridEndDay } = focusCalendarWindow(endDay, variant);
  const range = useMemo(() => getLogicalDayRange(startDay, endDay, startOfDayMinutes), [startDay, endDay, startOfDayMinutes]);
  const key = `${range.start}:${range.end}`;
  const [history, setHistory] = useState<{ key: string; segments: ActivitySegment[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selectedDay, setSelectedDay] = useState(endDay);
  const grid = useRef<HTMLDivElement>(null);
  const tooltipTimer = useRef<number | null>(null);
  const tooltipOpen = useRef(false);
  const pendingTooltip = useRef<CalendarTooltip | null>(null);
  const [tooltip, setTooltip] = useState<CalendarTooltip | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    setFailedKey(null);
    void loadHistory(range).then(result => {
      if (!cancelled) setHistory({ key, segments: result.materialized.segments });
    }).catch(() => { if (!cancelled) setFailedKey(key); });
    return () => { cancelled = true; };
  }, [key, range, loadHistory, retry]);
  useEffect(() => () => {
    if (tooltipTimer.current) window.clearTimeout(tooltipTimer.current);
  }, []);
  useEffect(() => {
    if (history?.key === key) return;
    if (tooltipTimer.current != null) window.clearTimeout(tooltipTimer.current);
    tooltipTimer.current = null;
    pendingTooltip.current = null;
    tooltipOpen.current = false;
    setTooltip(null);
  }, [history?.key, key]);
  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!tooltip || !node) return;
    const aligned = alignCalendarTooltip(tooltip.x, node.offsetWidth, window.innerWidth);
    node.style.left = `${aligned.left}px`;
    node.style.setProperty("--caret-shift", `${aligned.caretShift}px`);
  }, [tooltip]);
  const ready = history?.key === key;
  const calibrationEndDay = endDayIsInProgress ? shiftIsoDate(endDay, -1) : endDay;
  const days = useMemo(() => {
    if (!ready || !history) return [];
    const segments = mergeActivitySegments(history.segments, recentSegments);
    return buildFocusCalendar(segments, startDay, gridEndDay, { ...classificationOptions, fallbackCandidates: segments }, startOfDayMinutes, calibrationEndDay)
      .map(day => day.day > endDay ? { ...day, trackedSeconds: 0, focusSeconds: 0, level: 0 } : day);
  }, [ready, history, recentSegments, startDay, gridEndDay, endDay, calibrationEndDay, classificationOptions, startOfDayMinutes]);
  const hasRelativeBasis = days.some(day => day.day <= calibrationEndDay && day.focusSeconds > 0);
  const offset = (new Date(`${startDay}T12:00:00`).getDay() + 6) % 7;
  const columns = Math.ceil((offset + days.length) / 7);
  const lastSelectable = days.findIndex(day => day.day === endDay);
  const activeDay = days.find(day => day.day === selectedDay && day.day <= endDay) ?? days[lastSelectable];
  const locale = effectiveLanguage === "ko" ? "ko-KR" : "en-US";
  const dateLabel = (day: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", weekday: "short" }).format(new Date(`${day}T12:00:00`));
  const relativeDescription = (level: number) => {
    if (level === 1) return t("trends.calendar.relativeLighter");
    if (level === 2) return t("trends.calendar.relativeTypical");
    if (level === 3) return t("trends.calendar.relativeStronger");
    return t("trends.calendar.relativeStrongest");
  };
  const description = (day: (typeof days)[number]) => {
    const status = day.day > endDay
      ? t("trends.calendar.afterSelected")
      : day.trackedSeconds <= 0
        ? t("trends.calendar.noRecord")
        : t("trends.calendar.focusDuration", { duration: formatLocalizedCompactDurationFromSeconds(day.focusSeconds, effectiveLanguage) });
    const relative = day.focusSeconds > 0
      ? ` · ${hasRelativeBasis ? relativeDescription(day.level) : t("trends.calendar.relativeBuilding")}`
      : "";
    return `${dateLabel(day.day)} · ${status}${relative}`;
  };
  function tooltipAnchor(el: HTMLElement): CalendarTooltip {
    const rect = el.getBoundingClientRect();
    const placement: CalendarTooltip["placement"] = rect.top < 44 ? "below" : "above";
    return { text: "", x: rect.left + rect.width / 2, y: placement === "above" ? rect.top : rect.bottom, placement };
  }
  function showTooltip(day: FocusCalendarDay, el: HTMLElement) {
    if (day.day > endDay) {
      hideTooltip();
      return;
    }
    const next = { ...tooltipAnchor(el), text: description(day) };
    pendingTooltip.current = next;
    if (tooltipOpen.current) {
      setTooltip(next);
      return;
    }
    if (tooltipTimer.current != null) return;
    tooltipTimer.current = window.setTimeout(() => {
      tooltipTimer.current = null;
      tooltipOpen.current = true;
      if (pendingTooltip.current) setTooltip(pendingTooltip.current);
    }, FOCUS_CALENDAR_TOOLTIP_DELAY_MS);
  }
  function hideTooltip() {
    if (tooltipTimer.current != null) {
      window.clearTimeout(tooltipTimer.current);
      tooltipTimer.current = null;
    }
    pendingTooltip.current = null;
    tooltipOpen.current = false;
    setTooltip(null);
  }
  function cellFromPoint(target: EventTarget | null): HTMLButtonElement | null {
    const el = target instanceof Element ? target.closest<HTMLButtonElement>("button.focus-calendar__cell") : null;
    return el && grid.current?.contains(el) ? el : null;
  }
  function onGridPointerOver(event: PointerEvent<HTMLDivElement>) {
    const cell = cellFromPoint(event.target);
    if (!cell) return;
    const day = days[Number(cell.dataset.dayIndex)];
    if (day) showTooltip(day, cell);
  }
  function onGridPointerLeave(event: PointerEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    hideTooltip();
  }
  function onGridBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    hideTooltip();
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const movement: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const target = event.key === "Home" ? 0 : event.key === "End" ? lastSelectable : event.key in movement ? Math.max(0, Math.min(lastSelectable, index + movement[event.key])) : null;
    if (target === null) return;
    event.preventDefault();
    setSelectedDay(days[target].day);
    grid.current?.querySelector<HTMLButtonElement>(`[data-day-index="${target}"]`)?.focus();
  }
  return (
    <section className="focus-calendar editorial-panel editorial-panel--soft insight-section" data-calendar-variant={variant} aria-label={t("trends.calendar.title")}>
      <div className="focus-calendar__head">
        <h2 className="label-mono insight-section__label">{t("trends.calendar.title")}</h2>
        <span title={`${startDay} – ${gridEndDay}`}>{variant === "year" ? year : t("trends.calendar.recentMonths", { count: variant === "quarter" ? "3" : "5" })}</span>
      </div>
      {!ready ? (
        <div className="focus-calendar__state" role="status">
          {failedKey === key ? <>{t("trends.calendar.failed")} <button className="app-btn app-btn--quiet app-btn--compact" onClick={() => setRetry(value => value + 1)}>{t("trends.calendar.retry")}</button></> : t("trends.calendar.loading")}
        </div>
      ) : (
        <>
          <div className="contribution-grid-shell">
            <div className="contribution-grid__layout" style={{ "--cadence-week-count": columns } as CSSProperties}>
              <div className="contribution-grid__month-spacer" aria-hidden="true" />
              <div className="contribution-grid__months" aria-hidden="true">
                {Array.from({ length: columns }, (_, column) => {
                  const date = new Date(`${shiftIsoDate(startDay, Math.max(0, column * 7 - offset))}T12:00:00`);
                  const previous = column > 0 ? new Date(`${shiftIsoDate(startDay, Math.max(0, (column - 1) * 7 - offset))}T12:00:00`) : null;
                  return <span key={column}>{!previous || previous.getMonth() !== date.getMonth() ? new Intl.DateTimeFormat(locale, { month: "short" }).format(date) : ""}</span>;
                })}
              </div>
              <div className="contribution-grid__weekdays" aria-hidden="true">
                {(effectiveLanguage === "ko" ? ["월", "", "수", "", "금", "", ""] : ["M", "", "W", "", "F", "", ""]).map((label, index) => <span key={index}>{label}</span>)}
              </div>
              <div className="contribution-grid" ref={grid} role="group" aria-label={t("trends.calendar.daysAria")} aria-description={t(hasRelativeBasis ? "trends.calendar.scale" : "trends.calendar.scalePending")} onPointerOver={onGridPointerOver} onPointerLeave={onGridPointerLeave} onBlur={onGridBlur}>
                {Array.from({ length: columns }, (_, column) => <div className="contribution-grid__week" key={column}>
                  {Array.from({ length: 7 }, (_, weekday) => {
                    const index = column * 7 + weekday - offset;
                    const day = days[index];
                    if (!day) return <span className="focus-calendar__pad" key={weekday} />;
                    const recordState = day.trackedSeconds <= 0
                      ? " focus-calendar__cell--untracked"
                      : day.focusSeconds <= 0
                        ? " focus-calendar__cell--tracked-zero"
                        : "";
                    return <button
                      key={day.day} type="button" className={`focus-calendar__cell contribution-grid__day contribution-grid__day--${day.level}${recordState}`}
                      data-day-index={index} aria-label={description(day)}
                      disabled={day.day > endDay}
                      tabIndex={activeDay?.day === day.day ? 0 : -1}
                      onFocus={(event) => { setSelectedDay(day.day); showTooltip(day, event.currentTarget); }}
                      onClick={() => setSelectedDay(day.day)} onKeyDown={event => navigate(event, index)}
                    />;
                  })}
                </div>)}
              </div>
            </div>
          </div>
          <div className="focus-calendar__legend contribution-grid__legend" aria-hidden="true">
            {hasRelativeBasis ? (
              <>
                <span className="focus-calendar__legend-basis">{t("trends.calendar.relativeBasis")}</span>
                <span>{t("trends.calendar.relativeLower")}</span>
                {[1, 2, 3, 4].map(level => <i className={`contribution-grid__day--${level}`} key={level} />)}
                <span>{t("trends.calendar.relativeHigher")}</span>
              </>
            ) : <span className="focus-calendar__legend-basis">{t("trends.calendar.relativePending")}</span>}
          </div>
          {tooltip && createPortal(
            <div ref={tooltipRef} className={`focus-calendar__tooltip focus-calendar__tooltip--${tooltip.placement}`} style={{ left: tooltip.x, top: tooltip.y }} role="tooltip" aria-hidden="true">
              {tooltip.text}
            </div>,
            document.body,
          )}
        </>
      )}
    </section>
  );
}
