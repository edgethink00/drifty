import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import type { WeekCalendarEvent, WeekCalendarEventIdentity, WeekCalendarEventStyle, WeekCalendarNowMarkerStyle, WeekDayRow } from "./weekCalendar";
import { CATEGORY_COLORS, categoryLabel } from "../../lib/activityLabels";
import { clockHourForLogicalHour, formatCalendarMinuteLabel, formatCompactDurationFromSeconds, formatHourLabel, logicalTodayIsoDate } from "../../lib/formatting";
import { logicalMinuteOfDay } from "@drifty/domain";
import type { AppIconMap, CategoryDuration, ProductivityDuration } from "@drifty/domain";
import { WeekCalendarHoverCard } from "./HoverCards";
import type { WeekCalendarHoverState } from "./HoverCards";
import { buildWeekCalendarEventLayout } from "./weekCalendarEventLayout";
import { useDeferredWeekIdentityIcons } from "./useDeferredWeekIdentityIcons";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

const ACTIVE_WEEK_CALENDAR_EVENT_Z_INDEX = 29;

export function WeekCalendarIdentityIcon({ identity, appIcons }: { identity: WeekCalendarEventIdentity; appIcons: AppIconMap }) {
  const iconSrc = appIcons[identity.bundleId ?? identity.appName] ?? appIcons[identity.appName] ?? null;
  if (identity.siteDomain) {
    return <SiteFavicon domain={identity.siteDomain} size={16} fallbackIconSrc={iconSrc} />;
  }

  return <AppGlyph appName={identity.label} iconSrc={identity.siteTitle ? null : iconSrc} size="sm" />;
}

export function WeekDashboard({
  rows,
  calendarEvents,
  appIcons,
  startDay,
  endDay,
  categoryEntries,
  productivityEntries,
  totalSeconds,
  focusDeltaPercent,
  refreshStatus,
  isPreviewSurface = false,
  startOfDayMinutes,
  dateNavigator,
}: {
  rows: WeekDayRow[];
  calendarEvents: Map<string, WeekCalendarEvent[]>;
  appIcons: AppIconMap;
  startDay: string;
  endDay: string;
  categoryEntries: CategoryDuration[];
  productivityEntries: ProductivityDuration[];
  totalSeconds: number;
  focusDeltaPercent: number | null;
  refreshStatus: "idle" | "loading" | "error";
  isPreviewSurface?: boolean;
  startOfDayMinutes: number;
  dateNavigator: ReactNode;
}) {
  const [weekHover, setWeekHover] = useState<WeekCalendarHoverState | null>(null);
  const [activeWeekEventId, setActiveWeekEventId] = useState<string | null>(null);
  const calendarScrollerRef = useRef<HTMLDivElement>(null);
  const calendarBodyRef = useRef<HTMLDivElement>(null);
  const autoScrollKeyRef = useRef<string | null>(null);
  const focusSeconds = productivityEntries.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  const driftSeconds = productivityEntries.find((entry) => entry.productivity === "drift")?.totalSeconds ?? 0;
  const productivePercent = totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0;
  const refreshStatusLabel = refreshStatus === "loading" ? "Updating" : refreshStatus === "error" ? "Update failed" : "Up to date";
  const activeCategories = categoryEntries
    .filter((entry) => entry.totalSeconds > 0)
    .slice()
    .sort((left, right) => right.totalSeconds - left.totalSeconds);
  const visibleCategories = activeCategories.slice(0, 5);
  const rankedRows = rows.slice().sort((left, right) => right.totalSeconds - left.totalSeconds || left.day.localeCompare(right.day));
  const bestDay = rankedRows.find((row) => row.totalSeconds > 0) ?? null;
  const peakSeconds = Math.max(rankedRows[0]?.totalSeconds ?? 0, 1);
  const summaryPeakSeconds = Math.max(...rows.map((row) => row.focusSeconds), 1);
  const todayDay = logicalTodayIsoDate(startOfDayMinutes);
  const calendarStartHour = 0;
  const calendarEndHour = 24;
  const calendarHourHeight = 56;
  const calendarHours = Array.from({ length: calendarEndHour - calendarStartHour }, (_, index) => calendarStartHour + index);
  const calendarRows = rows;
  const canMountIdentityIcons = useDeferredWeekIdentityIcons({ calendarEvents, endDay, startDay });
  const minCalendarMinute = calendarStartHour * 60;
  const maxCalendarMinute = calendarEndHour * 60;
  const isCurrentCalendarWeek = startDay <= todayDay && todayDay <= endDay;
  const currentCalendarMinute = isCurrentCalendarWeek
    ? Math.min(maxCalendarMinute, Math.max(minCalendarMinute, logicalMinuteOfDay(new Date().getHours() * 60 + new Date().getMinutes(), startOfDayMinutes)))
    : null;
  const currentCalendarOffset = currentCalendarMinute === null
    ? null
    : ((currentCalendarMinute - minCalendarMinute) / 60) * calendarHourHeight;
  const currentCalendarLabel = currentCalendarMinute === null ? null : formatCalendarMinuteLabel(todayDay, currentCalendarMinute, startOfDayMinutes);
  const currentCalendarLineEnd = String(calendarRows.findIndex((row) => row.day === todayDay) + 3);
  const currentCalendarMarkerStyle = currentCalendarOffset === null
    ? null
    : {
        "--week-calendar-now-offset": `${currentCalendarOffset}px`,
        "--week-calendar-now-line-end": currentCalendarLineEnd,
      } as WeekCalendarNowMarkerStyle;
  const autoScrollTargetMinute = useMemo(() => {
    if (currentCalendarMinute !== null) return currentCalendarMinute;

    const earliestEventOffset = calendarRows.reduce<number | null>((earliest, row) => {
      const firstEvent = calendarEvents.get(row.day)?.[0];
      if (!firstEvent) return earliest;
      return earliest === null ? firstEvent.topMinutes : Math.min(earliest, firstEvent.topMinutes);
    }, null);

    return earliestEventOffset === null
      ? minCalendarMinute
      : Math.min(maxCalendarMinute, Math.max(minCalendarMinute, minCalendarMinute + earliestEventOffset));
  }, [calendarEvents, calendarRows, currentCalendarMinute, maxCalendarMinute, minCalendarMinute]);

  useLayoutEffect(() => {
    const scroller = calendarScrollerRef.current;
    const body = calendarBodyRef.current;
    if (!scroller || !body) return;

    const scrollKey = `${startDay}:${endDay}:${autoScrollTargetMinute}`;
    if (autoScrollKeyRef.current === scrollKey) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const timelineOffset = ((autoScrollTargetMinute - minCalendarMinute) / 60) * calendarHourHeight;
    const bodyTop = bodyRect.top - scrollerRect.top + scroller.scrollTop;
    const weekTimelineViewportAnchorRatio = 0.58;
    const viewportAnchor = Math.max(96, scroller.clientHeight * weekTimelineViewportAnchorRatio);
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, bodyTop + timelineOffset - viewportAnchor));

    scroller.scrollTop = nextScrollTop;
    autoScrollKeyRef.current = scrollKey;
  }, [autoScrollTargetMinute, calendarHourHeight, endDay, minCalendarMinute, startDay]);

  return (
    <section className="week-v2" aria-label="Your week overview">
      <div className="week-v2-grid week-v2-grid--calendar">
        <section className="week-v2-calendar editorial-panel editorial-panel--soft" aria-label="Week calendar schedule">
          <div className="week-v2-summary week-v2-summary--compact week-v2-summary--integrated" aria-label="Week summary">
            <div className="week-v2-summary__main">
              <span className="label-mono">Week focus</span>
              <strong>{isPreviewSurface ? "40h 40m" : focusSeconds > 0 ? formatCompactDurationFromSeconds(focusSeconds) : "0m"}</strong>
            </div>
            <div className="week-v2-summary__bars" aria-hidden="true">
              {calendarRows.map((row) => {
                const ratio = row.focusSeconds > 0 ? row.focusSeconds / summaryPeakSeconds : 0;
                const barHeight = row.focusSeconds > 0 ? Math.max(4, Math.round(ratio * 30)) : 2;
                const isPeak = bestDay?.day === row.day && row.focusSeconds > 0;
                const isToday = todayDay === row.day;
                const dayLetter = row.dayName.charAt(0);
                return (
                  <span
                    className={`week-v2-summary__bar${isPeak ? " is-peak" : ""}${isToday ? " is-today" : ""}${row.focusSeconds === 0 ? " is-empty" : ""}`}
                    key={row.day}
                    title={`${row.dayName} ${row.dayNumber} · ${row.focusSeconds > 0 ? formatCompactDurationFromSeconds(row.focusSeconds) : "No focus"}`}
                  >
                    <span className="week-v2-summary__bar-fill" style={{ height: `${barHeight}px` }} />
                    <small>{dayLetter}</small>
                  </span>
                );
              })}
            </div>
            <div className="week-v2-summary__meta">
              <span className={`week-v2-summary__refresh week-v2-summary__refresh--${refreshStatus}`} aria-live="polite">{refreshStatusLabel}</span>
              <span>{focusDeltaPercent !== null ? `${focusDeltaPercent >= 0 ? "▲" : "▼"} ${Math.abs(focusDeltaPercent)}% vs last week` : "No prior week"}</span>
              <span>Focus share {isPreviewSurface ? 77 : productivePercent}%</span>
              <span>Drift {isPreviewSurface ? "6h 25m" : driftSeconds > 0 ? formatCompactDurationFromSeconds(driftSeconds) : "0m"}</span>
            </div>
            <div className="week-v2-summary__actions">
              {dateNavigator}
            </div>
          </div>
          {activeCategories.length > 0 ? (
            <div className="week-v2-calendar__legend" aria-label="Week category legend">
              {activeCategories.map((entry) => (
                <span className="week-v2-calendar__legend-item" key={entry.category}>
                  <span className={`category-dot category-dot--${entry.category}`} aria-hidden="true" />
                  <span>{categoryLabel(entry.category)}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div ref={calendarScrollerRef} className="week-v2-calendar__scroller">
            <div className="week-v2-calendar__day-head" aria-hidden="true">
              <span />
              {calendarRows.map((row) => {
                const weekday = new Date(`${row.day}T12:00:00`).getDay();
                const isWeekend = weekday === 0 || weekday === 6;
                return (
                  <span className={`${isWeekend ? "is-weekend" : ""}${row.day === todayDay ? " is-today" : ""}`.trim()} key={row.day}>
                    <strong>{row.dayName}</strong>
                    <small>{row.dayNumber}</small>
                  </span>
                );
              })}
            </div>
            <div ref={calendarBodyRef} className="week-v2-calendar__body" style={{ height: `${(calendarEndHour - calendarStartHour) * calendarHourHeight}px` }}>
              <div className="week-v2-calendar__time-rail">
                {calendarHours.map((hour) => (
                  <span key={hour} style={{ top: `${(hour - calendarStartHour) * calendarHourHeight}px` }}>{formatHourLabel(clockHourForLogicalHour(hour, startOfDayMinutes))}</span>
                ))}
                <span
                  className="week-v2-calendar__time-rail-endpoint"
                  style={{ top: `${(calendarEndHour - calendarStartHour) * calendarHourHeight}px` }}
                >
                  {formatHourLabel(clockHourForLogicalHour(calendarEndHour, startOfDayMinutes))}
                </span>
              </div>
              {currentCalendarMarkerStyle && currentCalendarLabel ? (
                <div
                  className="week-v2-calendar__now-marker week-v2-calendar__now-marker--line"
                  style={currentCalendarMarkerStyle}
                  aria-hidden="true"
                >
                  <span className="week-v2-calendar__now-line" />
                  <span className="week-v2-calendar__now-cap" aria-hidden="true" />
                </div>
              ) : null}
              {calendarRows.map((row) => {
                const events = calendarEvents.get(row.day) ?? [];
                return (
                  <div className={`week-v2-calendar__day-column${row.day === todayDay ? " is-today" : ""}`} key={row.day}>
                    {calendarHours.map((hour) => (
                      <span className="week-v2-calendar__line" key={`${row.day}-${hour}`} style={{ top: `${(hour - calendarStartHour) * calendarHourHeight}px` }} />
                    ))}
                    {events.map((event) => {
                      const eventLayout = buildWeekCalendarEventLayout(event, calendarHourHeight);
                      const eventStyle: WeekCalendarEventStyle = {
                        top: `${(event.topMinutes / 60) * calendarHourHeight}px`,
                        height: `${eventLayout.eventHeight}px`,
                        left: event.laneCount > 1 ? `calc(${event.lane * 12}px + 4px)` : "4px",
                        width: event.laneCount > 1 ? "calc(100% - 32px)" : "calc(100% - 8px)",
                        zIndex: activeWeekEventId === event.id ? ACTIVE_WEEK_CALENDAR_EVENT_Z_INDEX : event.laneCount > 1 ? 10 + event.lane : 3,
                        "--event-tone": CATEGORY_COLORS[event.category],
                      };
                      return (
                        <article
                          aria-label={event.detailTitle.replace(/\n/g, ", ")}
                          className={`week-v2-calendar__event week-v2-calendar__event--${event.productivity}${event.isShort ? " week-v2-calendar__event--short" : ""}${event.isGroupedCluster ? " week-v2-calendar__event--grouped" : ""}${eventLayout.hidesInlineText ? " week-v2-calendar__event--micro" : ""}${event.laneCount > 2 ? " week-v2-calendar__event--dense" : ""}${eventLayout.isCompactEvent ? " week-v2-calendar__event--compact" : ""}`}
                          key={event.id}
                          tabIndex={0}
                          style={eventStyle}
                          title={event.detailTitle}
                          onFocus={() => setActiveWeekEventId(event.id)}
                          onBlur={() => setActiveWeekEventId(null)}
                          onMouseEnter={(pointerEvent: MouseEvent<HTMLElement>) => {
                            setActiveWeekEventId(event.id);
                            setWeekHover({ event, x: pointerEvent.clientX, y: pointerEvent.clientY });
                          }}
                          onMouseMove={(pointerEvent: MouseEvent<HTMLElement>) => {
                            setActiveWeekEventId(event.id);
                            setWeekHover({ event, x: pointerEvent.clientX, y: pointerEvent.clientY });
                          }}
                          onMouseLeave={() => {
                            setActiveWeekEventId(null);
                            setWeekHover(null);
                          }}
                        >
                          <span className={`category-dot category-dot--${event.category}`} aria-hidden="true" />
                          {eventLayout.showsIdentityStrip ? (
                            <span className="week-v2-calendar__identity-strip" aria-hidden="true">
                              {event.identities.map((identity) => (
                                <span className="week-v2-calendar__identity" key={identity.id} title={identity.label}>
                                  {canMountIdentityIcons ? <WeekCalendarIdentityIcon appIcons={appIcons} identity={identity} /> : null}
                                </span>
                              ))}
                              {event.hiddenIdentityCount > 0 ? (
                                <span className="week-v2-calendar__identity-more">+{event.hiddenIdentityCount}</span>
                              ) : null}
                            </span>
                          ) : null}
                          {eventLayout.hidesInlineText ? null : <strong className={event.isGroupedCluster ? "week-v2-calendar__event-label" : undefined}>{event.appName}</strong>}
                          {!eventLayout.isCompactEvent ? <small>{event.startLabel}–{event.endLabel}</small> : null}
                          {eventLayout.showsInlineDetail ? <em>{event.detailSummary}</em> : null}
                        </article>
                      );
                    })}
                  </div>
                );
              })}
              {currentCalendarMarkerStyle && currentCalendarLabel ? (
                <div
                  className="week-v2-calendar__now-marker week-v2-calendar__now-marker--overlay"
                  style={currentCalendarMarkerStyle}
                  aria-label={`Current time ${currentCalendarLabel}`}
                >
                  <span className="week-v2-calendar__now-label">{currentCalendarLabel}</span>
                </div>
              ) : null}
            </div>
          </div>
        </section>
        {weekHover ? <WeekCalendarHoverCard appIcons={appIcons} hover={weekHover} /> : null}

        <aside className="week-v2-side" aria-label="Week time breakdown">
          <section className="week-v2-side-card" aria-label="Week totals by category">
            <span className="label-mono">Category mix</span>
            {visibleCategories.length > 0 ? (
              <div className="week-v2-cat-list">
                {visibleCategories.map((entry) => (
                  <div className="week-v2-cat-row" key={entry.category}>
                    <div className="week-v2-cat-row__head">
                      <span className={`category-dot category-dot--${entry.category}`} aria-hidden="true" />
                      <strong>{categoryLabel(entry.category)}</strong>
                      <span>{Math.round(entry.ratio * 100)}%</span>
                    </div>
                    <div className="week-v2-cat-row__bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(entry.ratio * 100, 2)}%`, background: CATEGORY_COLORS[entry.category] }} />
                    </div>
                    <div className="week-v2-cat-row__delta">
                      <span>{formatCompactDurationFromSeconds(entry.totalSeconds)}</span>
                      <span>of tracked week</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="week-v2-empty">No tracked categories yet.</p>
            )}
          </section>

          <section className="week-v2-side-card" aria-label="Ranked days">
            <span className="label-mono">Ranked days</span>
            <ol className="week-v2-rank">
              {rankedRows.map((row, index) => {
                const hasActivity = row.totalSeconds > 0;
                const widthPercent = hasActivity ? Math.max((row.totalSeconds / peakSeconds) * 100, 2) : 0;
                return (
                  <li className={hasActivity ? undefined : "is-empty"} key={row.day}>
                    <span className="week-v2-rank__pos">{String(index + 1).padStart(2, "0")}</span>
                    <span className="week-v2-rank__day">
                      <strong>{row.dayName} {row.dayNumber}</strong>
                      <small>{hasActivity ? `FS ${row.focusScore}` : "No activity"}</small>
                    </span>
                    <span className="week-v2-rank__bar" aria-hidden="true"><span style={{ width: `${widthPercent}%` }} /></span>
                    <span className="week-v2-rank__val">{hasActivity ? formatCompactDurationFromSeconds(row.totalSeconds) : "—"}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>
    </section>
  );
}
