import { useEffect, useRef, useState } from "react";

import { formatLocalizedDayLabel, localeForDisplayLanguage } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { teamExportDayText, teamExportMonthWeeks, teamExportRangeClass, teamExportShiftMonth, type TeamExportWindow } from "./teamExportRange";

export type TeamExportDateFieldProps = {
  readonly label: string;
  readonly value: string;
  /** The earliest and latest days it may take (the latest is today). */
  readonly minDay: string;
  readonly maxDay: string;
  readonly onChange: (day: string) => void;
  /** The range this day bounds, shaded in its month. */
  readonly range?: TeamExportWindow;
};

const CHEVRON = <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>;

/**
 * One day of the export's range, as Dayflow's export takes its start and end:
 * a label over a day button that opens a month to pick from. The button shows
 * the day short with its weekday (the year only when it is not this year's);
 * the month shades the range it bounds. Days after today or before the records
 * begin are off; Escape or a click elsewhere closes it.
 */
export function TeamExportDateField({ label, value, minDay, maxDay, onChange, range }: TeamExportDateFieldProps): JSX.Element {
  const { effectiveLanguage: language, t } = useLocalization();
  const locale = localeForDisplayLanguage(language);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value.slice(0, 8) + "01");
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key !== "Escape" : rootRef.current?.contains(event.target as Node)) return;
      if (event instanceof KeyboardEvent) event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismiss, true);
    };
  }, [open]);
  const monthName = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(month + "T00:00:00Z"));
  const dayName = teamExportDayText(value, locale, maxDay, "long");
  const shown = teamExportDayText(value, locale, maxDay, "short");
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 19 + index))));
  return (
    <div ref={rootRef} className="team-date">
      <span className="team-date__label">{label}</span>
      <button
        type="button"
        className={"team-date__button" + (open ? " is-open" : "")}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label + ", " + dayName}
        onClick={() => {
          setMonth(value.slice(0, 8) + "01");
          setOpen((current) => !current);
        }}
      >
        <span>{shown}</span>
        {CHEVRON}
      </button>
      {open ? (
        <div className="team-date__panel" role="dialog" aria-label={label}>
          <div className="team-date__head">
            <button type="button" className="team-date__step" aria-label={t("team.export.previousMonth")} disabled={month <= minDay.slice(0, 8) + "01"} onClick={() => setMonth(teamExportShiftMonth(month, -1))}>‹</button>
            <span className="team-date__month">{monthName}</span>
            <button type="button" className="team-date__step" aria-label={t("team.export.nextMonth")} disabled={month >= maxDay.slice(0, 8) + "01"} onClick={() => setMonth(teamExportShiftMonth(month, 1))}>›</button>
          </div>
          <div className="team-date__grid" role="grid" aria-label={monthName}>
            <div className="team-date__row" role="row">
              {weekdays.map((name, index) => <span key={index} role="columnheader" className="team-date__weekday">{name}</span>)}
            </div>
            {teamExportMonthWeeks(month).map((week, index) => (
              <div className="team-date__row" role="row" key={index}>
                {week.map((day, cell) => (day ? (
                  <button
                    key={day}
                    type="button"
                    role="gridcell"
                    className={"team-date__day" + (day === value ? " is-on" : "") + (day === maxDay ? " is-today" : "") + teamExportRangeClass(day, range ?? null)}
                    aria-selected={day === value || undefined}
                    aria-label={formatLocalizedDayLabel(day, language)}
                    disabled={day < minDay || day > maxDay}
                    onClick={() => {
                      onChange(day);
                      setOpen(false);
                    }}
                  >
                    {Number(day.slice(8))}
                  </button>
                ) : <span key={cell} className="team-date__day is-outside" aria-hidden="true" />))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
