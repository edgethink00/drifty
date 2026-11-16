import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { ActivitySegment, AppIconMap, Project } from "@drifty/domain";
import { shiftIsoDate } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { MetricTile } from "../../components/MetricTile";
import { SiteFavicon } from "../../components/SiteFavicon";
import { buildIsoDayList, isoDateFromTimestamp } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { ProjectDetailFormat } from "./projectDetailFormat";
import {
  averageBeforeLatest,
  buildPeriodTotals,
  sessionHeadline,
  type DetailDay,
  type DetailSession,
  type DetailSource,
  type DetailSourceRef,
  type DetailTitle,
  type ProjectDetailModel,
} from "./projectDetailModel";

export type ProjectDetailRangeMode = "day" | "week" | "month";

/** Weeks the recent-trend section looks back over, in every range. */
export const PROJECT_DETAIL_TREND_WEEKS = 8;

// ── shared pieces ─────────────────────────────────────────────────────────

export function PanelHead({ title, meta }: { readonly title: string; readonly meta?: string | null }) {
  return (
    <div className="insight-panel-head pd-panel__head">
      <span className="label-mono">{title}</span>
      {meta ? <span className="pd-meta">{meta}</span> : null}
    </div>
  );
}

/** One section of the right-hand block: a mono head with an optional count or way back, then its body. */
export function RailPart({ title, meta, action, className, children }: {
  readonly title: string;
  readonly meta?: string | null;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className={"pd-railpart" + (className ? " " + className : "")}>
      <div className="pd-railpart__head">
        <span className="label-mono">{title}</span>
        {meta ? <span className="pd-meta">{meta}</span> : null}
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

export function BigFigure({ value, caption }: { readonly value: string; readonly caption?: string | null }) {
  return <p className="pd-bigfigure"><strong>{value}</strong>{caption ? <span>{caption}</span> : null}</p>;
}

export function BackLink({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button type="button" className="pd-back" onClick={onClick}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 4 6 8l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {label}
    </button>
  );
}

export function SourceIcon({ source, appIcons, size = 16 }: { readonly source: DetailSourceRef; readonly appIcons: AppIconMap; readonly size?: number }) {
  const appIcon = appIcons[source.bundleId ?? source.appName] ?? appIcons[source.appName] ?? null;
  return (
    <span className="pd-icon" style={{ width: size, height: size } as CSSProperties} aria-hidden="true">
      {source.domain ? <SiteFavicon domain={source.domain} size={size} fallbackIconSrc={appIcon} /> : <AppGlyph appName={source.appName} iconSrc={appIcon} size="sm" />}
    </span>
  );
}

export function placeCount(count: number, t: ReturnType<typeof useLocalization>["t"]): string {
  return count === 1 ? t("projects.detail.placeCountOne") : t("projects.detail.placeCount", { count });
}

export function sessionCount(count: number, t: ReturnType<typeof useLocalization>["t"]): string {
  return count === 1 ? t("classification.sessionCountOne") : t("classification.sessionCount", { count });
}

/** Ranked apps and sites with their share of the time and a thin bar in the project's colour. */
export function SourceRows({ sources, total, color, appIcons, format, limit = 4 }: {
  readonly sources: readonly DetailSource[];
  readonly total: number;
  readonly color: string;
  readonly appIcons: AppIconMap;
  readonly format: ProjectDetailFormat;
  readonly limit?: number;
}) {
  const { t } = useLocalization();
  const shown = sources.slice(0, limit);
  const rest = sources.slice(limit);
  const max = shown[0]?.seconds ?? 0;
  if (shown.length === 0) return <p className="pd-empty">{t("projects.detail.sourcesEmpty")}</p>;
  return (
    <ol className="pd-sources">
      {shown.map((source) => {
        const share = format.pct(total > 0 ? source.seconds / total : 0);
        return (
          <li className="pd-source" key={source.key} title={source.label + " · " + format.duration(source.seconds) + " (" + share + ")"}>
            <SourceIcon source={source} appIcons={appIcons} />
            <span className="pd-source__body">
              <span className="pd-source__line">
                <strong>{source.label}</strong>
                <span className="pd-source__time">{format.duration(source.seconds)}</span>
                <span className="pd-source__pct">{share}</span>
              </span>
              <span className="pd-source__bar"><span style={{ width: (max > 0 ? Math.max((source.seconds / max) * 100, 2) : 0) + "%", background: color }} /></span>
            </span>
          </li>
        );
      })}
      {rest.length > 0 ? (
        <li className="pd-source__more">{t("projects.detail.moreSources", { count: rest.length, duration: format.duration(rest.reduce((sum, item) => sum + item.seconds, 0)) })}</li>
      ) : null}
    </ol>
  );
}

export function TitleRows({ titles, appIcons, format, limit = 5 }: { readonly titles: readonly DetailTitle[]; readonly appIcons: AppIconMap; readonly format: ProjectDetailFormat; readonly limit?: number }) {
  return (
    <ol className="pd-titles">
      {titles.slice(0, limit).map((title) => (
        <li key={title.key} title={title.label + " · " + title.source.label}>
          <SourceIcon source={title.source} appIcons={appIcons} />
          <span className="pd-titles__label">{title.label}</span>
          <span className="pd-titles__time">{format.duration(title.seconds)}</span>
        </li>
      ))}
    </ol>
  );
}

// ── main column: by-date bars ─────────────────────────────────────────────

interface BarsHover { readonly label: string; readonly total: string; readonly x: number; readonly y: number }
interface DateBarDay { readonly day: string; readonly seconds: number }

function niceStepHours(maxHours: number): number {
  for (const step of [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12]) if (maxHours / step <= 3.2) return step;
  return 24;
}

/**
 * The project's time by date, the chart every range opens with. Week and Month
 * show the window's days; Day shows the seven days ending on the chosen day
 * with that day in full colour, so it stays a by-date chart in every range.
 * In Week and Month a bar picks its day; picking it again returns to all.
 */
export function DateBarsPanel({ project, rangeMode, startDay, endDay, windowSegments, historySegments, projectBySegmentId, format, selectedDay, onSelectDay }: {
  readonly project: Project;
  readonly rangeMode: ProjectDetailRangeMode;
  readonly startDay: string;
  readonly endDay: string;
  readonly windowSegments: readonly ActivitySegment[];
  readonly historySegments: readonly ActivitySegment[];
  readonly projectBySegmentId: ReadonlyMap<string, string>;
  readonly format: ProjectDetailFormat;
  readonly selectedDay: string | null;
  readonly onSelectDay: (day: string | null) => void;
}) {
  const { t } = useLocalization();
  const [hover, setHover] = useState<BarsHover | null>(null);
  const isDay = rangeMode === "day";
  const firstDay = isDay ? shiftIsoDate(endDay, -6) : startDay;
  const days = useMemo<DateBarDay[]>(() => {
    const list = buildIsoDayList(firstDay, endDay);
    const index = new Map(list.map((day, position) => [day, position]));
    const totals = list.map(() => 0);
    for (const segment of isDay ? historySegments : windowSegments) {
      if (projectBySegmentId.get(segment.id) !== project.id) continue;
      const position = index.get(isoDateFromTimestamp(segment.startedAt) ?? "");
      if (position !== undefined) totals[position]! += segment.durationSeconds;
    }
    return list.map((day, position) => ({ day, seconds: totals[position]! }));
  }, [firstDay, endDay, isDay, historySegments, windowSegments, projectBySegmentId, project.id]);
  const shownSeconds = isDay ? days[days.length - 1]?.seconds ?? 0 : days.reduce((sum, day) => sum + day.seconds, 0);
  const lastActive = useMemo(() => {
    if (shownSeconds > 0) return null;
    let latest = "";
    for (const segment of historySegments) {
      if (projectBySegmentId.get(segment.id) !== project.id) continue;
      const day = isoDateFromTimestamp(segment.startedAt) ?? "";
      if (day <= endDay && day > latest) latest = day;
    }
    return latest || null;
  }, [shownSeconds, historySegments, projectBySegmentId, project.id, endDay]);
  const maxSeconds = Math.max(...days.map((day) => day.seconds), 0);
  const maxHours = Math.max(maxSeconds, 1) / 3600;
  const step = niceStepHours(maxHours);
  const top = Math.max(maxHours * 1.08, step * 1.05);
  // An empty week draws no scale: a lone "0.25h" line would claim a size there is none of.
  const ticks: number[] = [];
  if (maxSeconds > 0) for (let value = step; value < top; value += step) ticks.push(value);
  const dense = days.length > 10;
  const selectable = !isDay;
  const focusDay = isDay ? endDay : selectedDay;
  const meta = isDay
    ? t("projects.detail.byDateDayMeta", { date: format.md(endDay) })
    : shownSeconds > 0
      ? selectedDay ? t("projects.detail.byDateSelected", { date: format.md(selectedDay) }) : t("projects.detail.byDateHint")
      : null;
  const show = (day: DateBarDay, event: MouseEvent<Element>) => setHover({
    label: format.dayTitle(day.day),
    total: day.seconds === 0 ? t("projects.detail.noTime") : format.duration(day.seconds),
    x: event.clientX,
    y: event.clientY,
  });
  const title = t("projects.detail.byDate");
  return (
    <section className="editorial-panel editorial-panel--soft pd-panel pd-datebars" aria-label={title}>
      <PanelHead title={title} meta={meta} />
      <div className={"ptc-bars pd-datebars__chart" + (dense ? " is-dense" : "") + (selectable ? " is-selectable" : "")}>
        <div className="ptc-bars__plot">
          <div className="ptc-bars__grid" aria-hidden="true">
            {ticks.map((value) => (
              <span className="ptc-bars__gridline" key={value} style={{ "--ptc-scale-y": 100 - (value / top) * 100 + "%" } as CSSProperties}><i>{Number(value.toFixed(2))}h</i></span>
            ))}
          </div>
          <div className="ptc-bars__columns" style={{ "--ptc-bar-columns": days.length } as CSSProperties}>
            {days.map((day, position) => {
              const label = dense ? (position % 5 === 0 || position === days.length - 1 ? format.md(day.day) : "") : <><span className="pd-datebars__weekday">{format.weekday(day.day)}</span>{format.md(day.day)}</>;
              const className = "ptc-bars__column pd-datebars__col" + (focusDay !== null && day.day !== focusDay ? " is-dim" : "") + (day.day === focusDay ? " is-focus" : "");
              const bar = (
                <>
                  <span className="ptc-bars__zone">
                    <span className="ptc-bars__stack" style={{ height: Math.min((day.seconds / 3600 / top) * 100, 100) + "%" }} onMouseEnter={(event) => show(day, event)} onMouseMove={(event) => show(day, event)} onMouseLeave={() => setHover(null)}>
                      <span className="ptc-bars__segment" style={{ height: "100%", background: project.color }} />
                    </span>
                  </span>
                  <span className="ptc-bars__day">{label}</span>
                </>
              );
              return selectable ? (
                <button
                  key={day.day}
                  type="button"
                  className={className}
                  disabled={day.seconds === 0}
                  aria-pressed={selectedDay === day.day}
                  aria-label={format.dayTitle(day.day) + " " + (day.seconds > 0 ? format.duration(day.seconds) : t("projects.detail.noTime"))}
                  onClick={() => onSelectDay(selectedDay === day.day ? null : day.day)}
                >
                  {bar}
                </button>
              ) : (
                <div key={day.day} className={className}>{bar}</div>
              );
            })}
          </div>
        </div>
      </div>
      {shownSeconds === 0 ? (
        // Only the loaded eight weeks are searched, so without a record there the line says so instead of "nothing yet".
        <p className="pd-datebars__empty">{lastActive ? t("projects.detail.lastRecorded", { day: format.dayTitle(lastActive) }) : t("projects.detail.nothingInWeeks")}</p>
      ) : null}
      {hover ? (
        <div className="ptc-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="presentation">
          <div className="ptc-tooltip__head"><span className="ptc-tooltip__day">{hover.label}</span><span className="ptc-tooltip__total">{hover.total}</span></div>
        </div>
      ) : null}
    </section>
  );
}

// ── main column: work log ─────────────────────────────────────────────────

function SessionRow({ session, appIcons, format, selected, onSelect, detail, detailId }: {
  readonly session: DetailSession;
  readonly appIcons: AppIconMap;
  readonly format: ProjectDetailFormat;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly detail?: ReactNode;
  readonly detailId?: string;
}) {
  const { lead, more } = sessionHeadline(session);
  return (
    <li>
      <button type="button" className={"pd-session" + (selected ? " is-selected" : "")} aria-pressed={selected} aria-expanded={detailId ? selected : undefined} aria-controls={detail ? detailId : undefined} data-session-id={session.id} onClick={onSelect}>
        <span className="pd-session__time">{format.clockRange(session.start, session.end)}</span>
        <span className="pd-session__lead">{session.sources[0] ? <SourceIcon source={session.sources[0]} appIcons={appIcons} /> : null}</span>
        <span className="pd-session__main"><strong>{lead}</strong>{more.length > 0 ? <span className="pd-session__more">{more.join(" · ")}</span> : null}</span>
        <span className="pd-session__dur">{format.duration(session.seconds)}</span>
        <svg className="pd-session__chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {detail}
    </li>
  );
}

/** Days newest first, three at a time; narrow windows open a session below its row. */
export function WorkLogPanel({ model, rangeMode, appIcons, format, selectedDay, selectedSessionId, onSelectSession, sessionDetail, sessionDetailId }: {
  readonly model: ProjectDetailModel;
  readonly rangeMode: ProjectDetailRangeMode;
  readonly appIcons: AppIconMap;
  readonly format: ProjectDetailFormat;
  readonly selectedDay: string | null;
  readonly selectedSessionId: string | null;
  readonly onSelectSession: (session: DetailSession) => void;
  readonly sessionDetail?: ReactNode;
  readonly sessionDetailId?: string;
}) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState(false);
  const days = model.days.filter((day) => day.seconds > 0 && (selectedDay === null || day.day === selectedDay)).reverse();
  const shown = expanded || selectedDay !== null ? days : days.slice(0, 3);
  if (days.length === 0) return null;
  const showDayHeads = selectedDay === null && rangeMode !== "day";
  const title = selectedDay ? t("projects.detail.dayWork", { day: format.dayTitle(selectedDay) }) : t("projects.detail.workLog");
  return (
    <section className="editorial-panel editorial-panel--soft pd-panel pd-log" aria-label={title}>
      <PanelHead title={title} />
      {shown.map((day) => (
        <div className="pd-log__day" key={day.day}>
          {/* A one-session day's total would repeat the row's own duration. */}
          {showDayHeads ? <div className="pd-log__day-head"><strong>{format.dayTitle(day.day)}</strong>{day.sessions.length > 1 ? <span>{format.duration(day.seconds)}</span> : null}</div> : null}
          <ol className="pd-log__sessions">
            {day.sessions.map((session) => (
              <SessionRow key={session.id} session={session} appIcons={appIcons} format={format} selected={session.id === selectedSessionId} onSelect={() => onSelectSession(session)} detail={session.id === selectedSessionId ? sessionDetail : null} detailId={sessionDetailId} />
            ))}
          </ol>
        </div>
      ))}
      {selectedDay === null && days.length > 3 ? (
        <button type="button" className="app-btn app-btn--quiet app-btn--compact pd-log__more" onClick={() => setExpanded((value) => !value)}>
          {expanded ? t("projects.detail.showLess") : t("projects.detail.earlierDays", { count: days.length - 3 })}
        </button>
      ) : null}
    </section>
  );
}

// ── right block ───────────────────────────────────────────────────────────

export interface FigureItem {
  readonly label: string;
  readonly value: string;
  /** The tile's caption line (MetricTile detail). */
  readonly detail: string;
}

/** The resting figures in the dashboard's own tiles, two by two. */
export function FigureTiles({ items }: { readonly items: readonly FigureItem[] }) {
  const { t } = useLocalization();
  return (
    <div className="kpi-row kpi-row--insights pd-kpi" role="group" aria-label={t("projects.detail.summaryAria")}>
      {items.map((item) => <MetricTile key={item.label} label={item.label} value={item.value} detail={item.detail} />)}
    </div>
  );
}

/** A day's own clock: this project's stretches over the rest of what was recorded that day. */
export function MiniLane({ day, range, color, format }: { readonly day: DetailDay; readonly range: readonly [number, number]; readonly color: string; readonly format: ProjectDetailFormat }) {
  const [from, to] = range;
  const span = (to - from) * 60;
  const position = (minute: number) => Math.min(100, Math.max(0, ((minute - from * 60) / span) * 100));
  return (
    <div className="pd-minilane" aria-hidden="true">
      <span className="pd-minilane__track">
        {day.otherIntervals.map(([start, end]) => <i key={"o" + start} className="pd-minilane__other" style={{ left: position(start) + "%", width: Math.max(position(end) - position(start), 0.4) + "%" }} />)}
        {day.projectIntervals.map(([start, end]) => <i key={"m" + start} className="pd-minilane__mine" style={{ left: position(start) + "%", width: Math.max(position(end) - position(start), 0.6) + "%", background: color }} />)}
      </span>
      <span className="pd-minilane__axis"><span>{format.hour(from)}</span><span>{format.hour(Math.round((from + to) / 2))}</span><span>{format.hour(to)}</span></span>
    </div>
  );
}

/** The block's last section: this project's time in each of the last eight weeks, the latest in full colour over a dashed average. */
export function RecentTrend({ project, historySegments, projectBySegmentId, endDay, format }: {
  readonly project: Project;
  readonly historySegments: readonly ActivitySegment[];
  readonly projectBySegmentId: ReadonlyMap<string, string>;
  readonly endDay: string;
  readonly format: ProjectDetailFormat;
}) {
  const { t } = useLocalization();
  const periods = useMemo(() => buildPeriodTotals({ projectId: project.id, segments: historySegments, projectBySegmentId, endDay, periodDays: 7, count: PROJECT_DETAIL_TREND_WEEKS }), [project.id, historySegments, projectBySegmentId, endDay]);
  const max = Math.max(...periods.map((period) => period.seconds), 1);
  const average = averageBeforeLatest(periods);
  const latest = periods[periods.length - 1]!;
  const delta = average === null ? 0 : latest.seconds - average;
  const [noteBefore, noteAfter] = t("projects.detail.recentVsAverage", { delta: "\u0000" }).split("\u0000");
  return (
    <RailPart title={t("projects.detail.recentWeeks")} meta={average ? t("projects.detail.averageMeta", { duration: format.duration(average) }) : null}>
      <div className="pd-trend" style={{ "--pd-trend-cols": periods.length } as CSSProperties}>
        {average ? <span className="pd-trend__avg" style={{ "--pd-trend-avg": average / max } as CSSProperties} /> : null}
        {periods.map((period, index) => {
          const current = index === periods.length - 1;
          return (
            <span key={period.startDay} className={"pd-trend__col" + (current ? " is-current" : "")} title={format.md(period.startDay) + "–" + format.md(period.endDay) + " · " + (period.seconds > 0 ? format.duration(period.seconds) : t("projects.detail.noTime"))}>
              <span className="pd-trend__zone"><span className="pd-trend__bar" style={{ height: Math.max((period.seconds / max) * 100, period.seconds > 0 ? 3 : 0) + "%", background: project.color }} /></span>
              <span className="pd-trend__label">{current ? t("projects.detail.latestWeek") : format.md(period.startDay)}</span>
            </span>
          );
        })}
      </div>
      {average ? (
        <p className="pd-trend__note">
          {noteBefore}<b className={delta >= 0 ? "is-up" : "is-down"}>{(delta >= 0 ? "+" : "−") + format.duration(Math.abs(delta))}</b>{noteAfter}
        </p>
      ) : <p className="pd-trend__note">{t("projects.detail.noEarlierWeeks")}</p>}
    </RailPart>
  );
}
