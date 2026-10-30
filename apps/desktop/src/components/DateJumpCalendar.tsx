import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

import { getCalendarWeekStartDay } from "../features/dashboard/weekCalendar";
import { useLocalization } from "../features/localization/LocalizationContext";
import type { StartOfWeek } from "../features/settings/settingsStorage";
import { formatLocalizedDayLabel, localeForDisplayLanguage } from "../lib/formatting";
import { NavChevronIcon } from "./NavChevronIcon";
import {
  calendarMonthOf,
  calendarMonthWeeks,
  lastReachableDay,
  movedFocusDay,
  pickedDay,
  shiftCalendarMonth,
  type DateJumpUnit,
} from "./dateJumpMonth";
import "./date-jump.css";

export type DateJumpPicker = {
  readonly unit: DateJumpUnit;
  /** The day being asked for; for weeks, any day inside the shown week. */
  readonly selectedDay: string;
  /** The logical today. Later days (for weeks, later weeks) cannot be picked. */
  readonly today: string;
  readonly startOfWeek: StartOfWeek;
  readonly onPick: (day: string) => void;
};

const DOWN_CHEVRON = (
  <svg className="date-jump__caret" viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
  </svg>
);

/**
 * The date navigator's caption as a button that opens a month to jump in.
 * Day picks a day; Week picks a whole row. Days after today are off, the
 * neighbouring months' days complete the first and last weeks, and Escape,
 * a press elsewhere or a pick closes it, returning focus to the caption.
 */
export function DateJumpCalendar({ label, picker }: { readonly label: string; readonly picker: DateJumpPicker }) {
  const { effectiveLanguage: language, t } = useLocalization();
  const locale = localeForDisplayLanguage(language);
  const { unit, selectedDay, today, startOfWeek, onPick } = picker;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => calendarMonthOf(selectedDay));
  const [focusDay, setFocusDay] = useState(selectedDay);
  // WebKit does not treat focus moved by script as :focus-visible, so the
  // grid shows its focus ring itself once the keyboard is driving it.
  const [keyboardDriven, setKeyboardDriven] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef(false);
  const panelId = useId();
  const lastDay = lastReachableDay(unit, today, startOfWeek);
  const reachable = (day: string) => (day > lastDay ? lastDay : day);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay, month]);

  const toggle = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (open) {
      setOpen(false);
      return;
    }
    const start = reachable(selectedDay);
    setMonth(calendarMonthOf(start));
    setFocusDay(start);
    // A click from Enter or Space carries no pointer detail.
    setKeyboardDriven(event.detail === 0);
    pendingFocusRef.current = true;
    setOpen(true);
  };

  const weeks = calendarMonthWeeks(month, startOfWeek);
  const selectedWeekStart = getCalendarWeekStartDay(selectedDay, startOfWeek);
  const tabDay = weeks.some((week) => week.includes(focusDay)) ? focusDay : reachable(month);

  const pick = (day: string) => {
    setOpen(false);
    triggerRef.current?.focus();
    const unchanged = unit === "week" ? getCalendarWeekStartDay(day, startOfWeek) === selectedWeekStart : day === selectedDay;
    if (!unchanged) onPick(pickedDay(day, today));
  };

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const moved = movedFocusDay(focusDay, event.key, startOfWeek);
    if (moved === null) return;
    event.preventDefault();
    const next = reachable(moved);
    if (calendarMonthOf(next) !== month) setMonth(calendarMonthOf(next));
    setFocusDay(next);
    setKeyboardDriven(true);
    pendingFocusRef.current = true;
  };

  const monthName = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(month + "T00:00:00Z"));
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const dialogLabel = t(unit === "week" ? "dateNavigator.chooseWeek" : "dateNavigator.chooseDay");

  return (
    <div ref={rootRef} className="date-jump">
      <button
        ref={triggerRef}
        type="button"
        className={"date-jump__trigger" + (open ? " is-open" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t(unit === "week" ? "dateNavigator.openWeek" : "dateNavigator.openDay", { date: label })}
        title={dialogLabel}
        onClick={toggle}
      >
        <strong>{label}</strong>
        {DOWN_CHEVRON}
      </button>
      {open ? (
        <div
          id={panelId}
          className={"date-jump__panel date-jump__panel--" + unit + (keyboardDriven ? " is-keyboard" : "")}
          role="dialog"
          aria-label={dialogLabel}
          onPointerDown={() => setKeyboardDriven(false)}
        >
          <div className="date-jump__head">
            <span className="date-jump__month" aria-live="polite">{monthName}</span>
            <button
              type="button"
              className="app-btn app-btn--quiet app-btn--compact app-btn--icon date-jump__step"
              aria-label={t("dateNavigator.previousMonth")}
              onClick={() => setMonth(shiftCalendarMonth(month, -1))}
            >
              <NavChevronIcon direction="left" />
            </button>
            <button
              type="button"
              className="app-btn app-btn--quiet app-btn--compact app-btn--icon date-jump__step"
              aria-label={t("dateNavigator.nextMonth")}
              disabled={month >= calendarMonthOf(lastDay)}
              onClick={() => setMonth(shiftCalendarMonth(month, 1))}
            >
              <NavChevronIcon direction="right" />
            </button>
          </div>
          <div ref={gridRef} className="date-jump__grid" role="grid" aria-label={monthName} onKeyDown={onGridKeyDown}>
            <div className="date-jump__row date-jump__row--head" role="row">
              {weeks[0]!.map((day) => (
                <span key={day} role="columnheader" className="date-jump__weekday">
                  {weekdayFormat.format(new Date(day + "T00:00:00Z"))}
                </span>
              ))}
            </div>
            {weeks.map((week) => {
              const weekSelected = unit === "week" && week[0] === selectedWeekStart;
              return (
                <div
                  key={week[0]}
                  role="row"
                  className={"date-jump__row" + (weekSelected ? " is-selected" : "") + (week[0]! > lastDay ? " is-off" : "")}
                >
                  {week.map((day) => {
                    const daySelected = unit === "day" && day === selectedDay;
                    return (
                      <button
                        key={day}
                        type="button"
                        role="gridcell"
                        data-day={day}
                        className={
                          "date-jump__day"
                          + (day.slice(0, 7) !== month.slice(0, 7) ? " is-outside" : "")
                          + (daySelected ? " is-on" : "")
                          + (day === today ? " is-today" : "")
                          + (day > today ? " is-later" : "")
                        }
                        aria-selected={unit === "week" ? weekSelected : daySelected}
                        aria-current={day === today ? "date" : undefined}
                        aria-label={formatLocalizedDayLabel(day, language)}
                        tabIndex={day === tabDay ? 0 : -1}
                        disabled={day > lastDay}
                        onFocus={() => setFocusDay(day)}
                        onClick={() => pick(day)}
                      >
                        {Number(day.slice(8))}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
