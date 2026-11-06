import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDateRangeLabel, formatLocalizedDayLabel, formatLocalizedQuarterHourLabel } from "../../lib/formatting";
import { WeekCalendarBoard } from "../dashboard/weekCalendarBoard";
import { buildWeekCalendarEventLayout } from "../dashboard/weekCalendarEventLayout";
import { WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT, formatWeekDashboardAxisPixelValue as pixels, weekDashboardAxisScalePercentToHourHeight } from "../dashboard/weekDashboardAxisScale";
import { useLocalization } from "../localization/LocalizationContext";
import { TEAM_UNASSIGNED_COLOR, dayNumberLabel, hourAxisLabel, isWeekend, weekdayShortLabel } from "./TeamFocusParts";
import type { TeamMemberDetailModel } from "./teamFocusModel";
import { currentMemberCalendarPage, memberCalendarForeground, memberCalendarHours, memberCalendarPages } from "./teamMemberWorkView";
import type { TeamProject } from "./teamTypes";

const hourHeight = weekDashboardAxisScalePercentToHourHeight(WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT);
function readCalendarStyle() {
  const style = typeof window === "undefined" ? null : window.getComputedStyle(document.documentElement);
  const tint = Number.parseFloat(style?.getPropertyValue("--week-event-surface-tint") ?? "");
  return {
    rootSize: Number.parseFloat(style?.fontSize ?? "") || 16,
    surface: style?.getPropertyValue("--surface").trim() || "#fafaf8",
    tint: Number.isFinite(tint) ? tint / 100 : 0.12,
  };
}

/** Your Week's board and event grammar, fed only the team's permitted project blocks. */
export function TeamMemberCalendar({ model, projects, nowMinuteOfDay }: {
  readonly model: TeamMemberDetailModel;
  readonly projects: readonly TeamProject[];
  readonly nowMinuteOfDay: number;
}): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const pages = memberCalendarPages(model.dayRows);
  const [pageIndex, setPageIndex] = useState(() => currentMemberCalendarPage(pages));
  const [selected, setSelected] = useState<{ day: string; index: number } | null>(null);
  const [calendarStyle, setCalendarStyle] = useState(readCalendarStyle);
  const scrollerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const refresh = () => setCalendarStyle(readCalendarStyle());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true });
    window.addEventListener("resize", refresh);
    refresh();
    return () => { observer.disconnect(); window.removeEventListener("resize", refresh); };
  }, []);
  const days = pages[pageIndex] ?? [];
  const hours = memberCalendarHours(days);
  const ticks = Array.from({ length: hours.end - hours.start + 1 }, (_, index) => hours.start + index);
  const offset = (minute: number) => pixels((minute / 60 - hours.start) * hourHeight);
  const projectName = (id: string | null) => projects.find((project) => project.id === id)?.name ?? t("team.focus.unassigned");
  const projectColor = (id: string | null) => projects.find((project) => project.id === id)?.color ?? TEAM_UNASSIGNED_COLOR;
  // A block carries its name where the team shares work titles by time; otherwise its project names it.
  const blockName = (block: { readonly title?: string | null; readonly project_id: string | null }) => block.title?.trim() || projectName(block.project_id);
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage);
  const selectedDay = selected ? days.find((day) => day.day === selected.day) : null;
  const selectedBlock = selected && selectedDay ? selectedDay.blocks?.[selected.index] : null;
  const hasBlocks = days.some((row) => !row.isFuture && (row.blocks?.length ?? 0) > 0);
  const range = days.length > 0 ? formatLocalizedDateRangeLabel(days[0]!.day, days[days.length - 1]!.day, effectiveLanguage) : "";
  const todayIndex = days.findIndex((day) => day.isToday);
  const nowStyle = todayIndex >= 0 && nowMinuteOfDay >= hours.start * 60 && nowMinuteOfDay < hours.end * 60
    ? { "--week-calendar-now-offset": offset(nowMinuteOfDay), "--week-calendar-now-line-end": todayIndex + 3 } as CSSProperties : null;
  const changePage = (index: number) => {
    setPageIndex(index);
    setSelected(null);
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  };

  return (
    <section className="week-v2-calendar week-v2-calendar--flat team-work-calendar" aria-labelledby="team-member-work-heading" style={{ "--team-calendar-days": Math.max(1, days.length), "--week-calendar-time-rail-width": effectiveLanguage === "de" || effectiveLanguage === "fr" ? "3.25rem" : "2rem" } as CSSProperties}>
      <div className="insight-panel-head">
        <h3 id="team-member-work-heading" className="label-mono">{t("team.member.workTimeline")}</h3>
        {pages.length > 1 ? <div className="team-work-calendar__paging">
          <button type="button" className="team-icon-btn" disabled={pageIndex === 0} aria-label={t("team.member.previousWeek")} onClick={() => changePage(pageIndex - 1)}>‹</button>
          <span>{range}</span>
          <button type="button" className="team-icon-btn" disabled={pageIndex >= pages.length - 1} aria-label={t("team.member.nextWeek")} onClick={() => changePage(pageIndex + 1)}>›</button>
        </div> : <span className="team-work-calendar__caption">{t("team.member.blocksOnly")}</span>}
      </div>
      <div role="group" aria-label={t("team.focus.calendarAria", { name: model.member.display_name })}>
        <WeekCalendarBoard scrollerRef={scrollerRef}>
          <div className="week-v2-calendar__day-head">
            <span />
            {days.map((row) => <span key={row.day} className={(row.isToday ? "is-today " : "") + (isWeekend(row.day) ? "is-weekend" : "")} title={formatLocalizedDayLabel(row.day, effectiveLanguage)}>
              <strong>{weekdayShortLabel(row.day, effectiveLanguage)}</strong><small>{dayNumberLabel(row.day, effectiveLanguage)}</small>
            </span>)}
          </div>
          <div ref={scrollerRef} className="week-v2-calendar__scroller">
            <div className="week-v2-calendar__body" style={{ height: pixels((hours.end - hours.start) * hourHeight) }}>
              <div className="week-v2-calendar__time-rail" aria-hidden="true">
                {ticks.map((hour) => <span key={hour} className={hour === hours.end ? "week-v2-calendar__time-rail-endpoint" : undefined} style={{ top: offset(hour * 60) }}>{hourAxisLabel(hour, effectiveLanguage)}</span>)}
              </div>
              {nowStyle ? <div className="week-v2-calendar__now-marker week-v2-calendar__now-marker--line" style={nowStyle} aria-hidden="true"><span className="week-v2-calendar__now-line" /><span className="week-v2-calendar__now-cap" /></div> : null}
              {days.map((row) => <div key={row.day} className={"week-v2-calendar__day-column" + (row.isToday ? " is-today" : "")} data-week-day={row.day}>
                {ticks.slice(0, -1).map((hour) => <span key={hour} className="week-v2-calendar__line" style={{ top: offset(hour * 60) }} aria-hidden="true" />)}
                {!row.isFuture ? (row.blocks ?? []).map((block, index) => {
                  const minutes = block.end_minute - block.start_minute;
                  const layout = buildWeekCalendarEventLayout({ durationMinutes: minutes, activeDurationMinutes: minutes, isShort: minutes <= 30, isGroupedCluster: false, laneCount: 1, sessionCount: 1 }, hourHeight, calendarStyle.rootSize);
                  // Shared team blocks have exact bounds: a text-height floor must not
                  // extend a short block into the following project's time slot.
                  const eventHeight = Math.min(layout.eventHeight, Math.max(2, minutes / 60 * hourHeight - 1));
                  const pressed = selected?.day === row.day && selected.index === index;
                  const start = formatLocalizedQuarterHourLabel(block.start_minute, effectiveLanguage);
                  const end = formatLocalizedQuarterHourLabel(block.end_minute, effectiveLanguage);
                  const label = (block.title?.trim() ? block.title.trim() + " · " : "") + projectName(block.project_id) + " · " + formatLocalizedDayLabel(row.day, effectiveLanguage) + " · " + start + "–" + end + " · " + duration(minutes * 60);
                  return <article key={index} className={"week-v2-calendar__event" + (layout.isCompactEvent ? " week-v2-calendar__event--compact" : "") + (layout.isTinyEvent ? " week-v2-calendar__event--tiny" : "") + (layout.isMicroEvent ? " week-v2-calendar__event--micro" : "") + (pressed ? " is-inspected" : "") + (block.project_id === null ? " is-unassigned" : "")} style={{ top: offset(block.start_minute), height: pixels(eventHeight), "--event-tone": projectColor(block.project_id), "--team-calendar-foreground": memberCalendarForeground(projectColor(block.project_id), calendarStyle.surface, calendarStyle.tint) } as CSSProperties}>
                    <button type="button" className="week-v2-calendar__event-open" aria-label={label} aria-pressed={pressed} title={label} onClick={() => setSelected({ day: row.day, index })}>
                      {!layout.hidesInlineText && eventHeight >= 8 + calendarStyle.rootSize * 0.84 ? <strong>{blockName(block)}</strong> : null}
                      {!layout.isCompactEvent ? <small className="week-v2-calendar__event-time"><span>{start}</span><span>–{end}</span></small> : null}
                    </button>
                  </article>;
                }) : null}
              </div>)}
              {nowStyle ? <div className="week-v2-calendar__now-marker week-v2-calendar__now-marker--overlay" style={nowStyle} aria-hidden="true"><span className="week-v2-calendar__now-label">{formatLocalizedQuarterHourLabel(nowMinuteOfDay, effectiveLanguage)}</span></div> : null}
            </div>
          </div>
        </WeekCalendarBoard>
      </div>
      <div className="team-work-calendar__selection" role="status" aria-live="polite">
        {selectedBlock && selectedDay ? <><span className="team-legend-swatch" style={{ background: projectColor(selectedBlock.project_id) }} /><strong>{blockName(selectedBlock)}</strong>{selectedBlock.title?.trim() ? <span>{projectName(selectedBlock.project_id)}</span> : null}<span>{formatLocalizedDayLabel(selectedDay.day, effectiveLanguage)} · {formatLocalizedQuarterHourLabel(selectedBlock.start_minute, effectiveLanguage)}–{formatLocalizedQuarterHourLabel(selectedBlock.end_minute, effectiveLanguage)}</span><b>{duration((selectedBlock.end_minute - selectedBlock.start_minute) * 60)}</b></> : <span>{t(hasBlocks ? "team.member.selectBlock" : "team.member.noBlocks")}</span>}
      </div>
    </section>
  );
}
