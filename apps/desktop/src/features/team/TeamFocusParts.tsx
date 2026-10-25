import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { getViewportSafeHoverPosition } from "../../components/hoverCardPosition";

import { formatLocalizedCompactDurationFromSeconds, formatLocalizedCompactHourLabel, formatLocalizedDayLabel, localeForDisplayLanguage, parseLocalIsoDay } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languagePreference";
import { useLocalization } from "../localization/LocalizationContext";
import { ProjectTrendBars } from "../projects/ProjectTrendBars";
import { NO_PROJECT_KEY, buildTrendGeometry, type ProjectTrendColumn } from "../projects/projectTrendView";
import "../projects/project-trend-chart.css";
import "../projects/projects.css";
import { ProfileAvatar } from "../leaderboard/leaderboardViewHelpers";
import type { TeamProjectShare } from "./teamFocusModel";
import type { TeamSharingScope } from "./teamSharingScope";

/**
 * Small pieces the team focus views share. They lean on the app's own grammar
 * (the Breakdown panel's category-stack and metric-tile, the Weekly Breakdown
 * plot tokens, Your Week's "Focused for" headline) so the team page reads like
 * the rest of Drifty rather than like a separate admin product.
 */

/** Unassigned time takes the neutral segment tone, so it follows the theme like "No project" does. */
export const TEAM_UNASSIGNED_COLOR = "var(--gray-seg)";

/**
 * The Breakdown panel's category stack, one segment per project in its color.
 * The member page uses the large stack; a team card uses the regular one.
 */
export function TeamMixBar({ shares, label, size = "lg" }: {
  readonly shares: readonly TeamProjectShare[];
  readonly label?: string;
  readonly size?: "md" | "lg";
}): JSX.Element {
  const total = shares.reduce((sum, share) => sum + share.seconds, 0);
  return (
    <span className={"category-stack team-mix-bar" + (size === "lg" ? " category-stack--large" : "") + (total <= 0 ? " is-empty" : "")} role="presentation" title={label}>
      {total > 0 ? shares.filter((share) => share.seconds > 0).map((share) => (
        <span key={share.projectId ?? "unassigned"} className="category-stack__segment" style={{ width: (share.seconds / total) * 100 + "%", background: share.color ?? TEAM_UNASSIGNED_COLOR }} title={share.name ? share.name + " · " + Math.round((share.seconds / total) * 100) + "%" : undefined} />
      )) : null}
    </span>
  );
}

export function weekdayShortLabel(day: string, language: DisplayLanguage): string {
  const parsed = parseLocalIsoDay(day);
  if (!parsed) return day;
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), { weekday: "short" }).format(parsed);
}

export function dayNumberLabel(day: string, language: DisplayLanguage): string {
  const parsed = parseLocalIsoDay(day);
  if (!parsed) return day;
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), { day: "numeric" }).format(parsed);
}

export function isWeekend(day: string): boolean {
  const parsed = parseLocalIsoDay(day);
  const weekday = parsed ? parsed.getDay() : 1;
  return weekday === 0 || weekday === 6;
}

export function hourAxisLabel(hour: number, language: DisplayLanguage): string {
  return formatLocalizedCompactHourLabel(hour, language);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/**
 * The Leaderboard's avatar (ProfileAvatar): a photo when there is one, else a
 * neutral initial. Neutral on purpose: project colors carry meaning on this
 * page, and a tinted initial would read as belonging to a project.
 */
export function TeamAvatar({ name, size = "md", src = null }: { readonly name: string; readonly size?: "sm" | "md" | "lg"; readonly src?: string | null }): JSX.Element {
  return <ProfileAvatar className={"team-avatar team-avatar--" + size} name={name.trim() || "?"} src={src} />;
}

/** A group's mark: the same initial on a rounded square, so a group never reads as a person. */
export function TeamGroupMark({ name, size = "md" }: { readonly name: string; readonly size?: "sm" | "md" }): JSX.Element {
  return <span className={"team-avatar team-avatar--group team-avatar--" + size} aria-hidden="true">{initialOf(name)}</span>;
}

/**
 * "Sales Team focused for 106h 43m" set like Your Week's page head: the words
 * in the muted weight, the figure in the display weight. The sentence comes
 * from the translation with the figure interpolated, so splitting on the
 * figure keeps each language's word order.
 */
export function TeamHeadline({ text, value, children }: { readonly text: string; readonly value: string; readonly children?: ReactNode }): JSX.Element {
  const index = value ? text.indexOf(value) : -1;
  const before = index >= 0 ? text.slice(0, index).trim() : text;
  const after = index >= 0 ? text.slice(index + value.length).trim() : "";
  return (
    <h2 className="team-focus__headline dashboard-page-head__title">
      {before ? <span className="dashboard-page-head__focus-word">{before}</span> : null}
      {index >= 0 ? <span className="dashboard-page-head__focus-value">{value}</span> : null}
      {after ? <span className="dashboard-page-head__focus-word">{after}</span> : null}
      {children}
    </h2>
  );
}

/** One sentence naming what the team sees at this scope and what stays private. */
export function describeScope(scope: TeamSharingScope, t: ReturnType<typeof useLocalization>["t"]): string {
  if (scope === "focus_blocks") return t("team.focus.scopeNote.blocks");
  if (scope === "member_focus") return t("team.focus.scopeNote.memberFocus");
  if (scope === "team_focus") return t("team.focus.scopeNote.teamFocus");
  return t("team.focus.scopeNote.projects");
}

/** "a little more than last week" in words, since a percentage reads like a score. */
export function describeDelta(pct: number | null, t: ReturnType<typeof useLocalization>["t"]): string | null {
  if (pct === null) return null;
  if (Math.abs(pct) < 3) return t("team.focus.delta.same");
  if (pct >= 25) return t("team.focus.delta.muchMore");
  if (pct > 0) return t("team.focus.delta.more");
  if (pct <= -25) return t("team.focus.delta.muchLess");
  return t("team.focus.delta.less");
}

/**
 * A panel as the original Teams dashboard, the personal Projects page and
 * Insights draw one: the shared editorial panel with an insight-panel-head
 * (a mono overline left; the total, as the Project share panel sets it, or
 * any control on the right).
 */
export function TeamCard({ id, title, total, aside, lead, onHandlePointerDown, className, children }: {
  readonly id: string;
  readonly title: string;
  readonly total?: string | null;
  readonly aside?: ReactNode;
  /** Before the title, such as a board widget's grip; with it, the grip and the title together are the handle. */
  readonly lead?: ReactNode;
  readonly onHandlePointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly className?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className={"team-card editorial-panel editorial-panel--soft insight-chart-panel" + (className ? " " + className : "")} aria-labelledby={id}>
      <div className="insight-panel-head">
        {lead ? (
          <span className="team-card__handle" onPointerDown={onHandlePointerDown}>
            {lead}
            <span className="label-mono" id={id}>{title}</span>
          </span>
        ) : <span className="label-mono" id={id}>{title}</span>}
        {aside ?? (total ? <strong className="projects-share__total">{total}</strong> : null)}
      </div>
      {children}
    </section>
  );
}

export type TeamTrendDay = {
  readonly day: string;
  readonly shares: readonly TeamProjectShare[];
};

type TrendHover = {
  readonly dayLabel: string;
  readonly totalLabel: string;
  readonly rows: readonly { readonly key: string; readonly label: string; readonly color: string; readonly durationLabel: string }[];
  readonly x: number;
  readonly y: number;
};

/**
 * Time per day stacked by project, drawn by the shared ProjectTrendBars (the
 * personal Projects allocation chart and the original Teams dashboard) with
 * the same hover card. Unassigned time takes the trailing neutral band.
 * Given names for its columns, it charts people (or anything else) rather than
 * days: each column is labelled by its name, below it and in the hover card.
 */
export function TeamTrendChart({
  days,
  order,
  language,
  ariaLabel,
  unassignedLabel,
  columnLabels,
  onSelectColumn,
}: {
  readonly days: readonly TeamTrendDay[];
  /** Bottom to top: biggest project first, unassigned last. */
  readonly order: readonly TeamProjectShare[];
  readonly language: DisplayLanguage;
  readonly ariaLabel: string;
  readonly unassignedLabel: string;
  /** Names for columns that are not days, by their key; every column is then labelled. */
  readonly columnLabels?: ReadonlyMap<string, string>;
  /** Opens what a column stands for (a person's page); the columns become clickable. */
  readonly onSelectColumn?: (key: string) => void;
}): JSX.Element {
  const [hover, setHover] = useState<TrendHover | null>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = hoverRef.current;
    if (!hover || !node) return;
    const bounds = node.getBoundingClientRect();
    const position = getViewportSafeHoverPosition(hover.x, hover.y, bounds.width, bounds.height);
    node.style.left = position.left + "px";
    node.style.top = position.top + "px";
  }, [hover]);
  const view = useMemo(() => {
    const keyOf = (share: TeamProjectShare) => share.projectId ?? NO_PROJECT_KEY;
    const series = order.map((share) => ({ key: keyOf(share), label: share.name ?? unassignedLabel, color: share.color ?? TEAM_UNASSIGNED_COLOR }));
    const seconds = new Map<string, number>();
    for (const entry of days) {
      for (const share of entry.shares) {
        const key = entry.day + " " + keyOf(share);
        seconds.set(key, (seconds.get(key) ?? 0) + share.seconds);
      }
    }
    const geometry = buildTrendGeometry({ dayList: days.map((entry) => entry.day), series, secondsFor: (day, key) => seconds.get(day + " " + key) ?? 0 });
    if (!columnLabels) return geometry;
    const nameOf = (key: string) => columnLabels.get(key) ?? key;
    return {
      ...geometry,
      columns: geometry.columns.map((column) => ({ ...column, label: nameOf(column.day), hoverLabel: nameOf(column.day) })),
      axisTicks: geometry.columns.map((column) => ({ id: "ptc-axis-" + column.day, label: nameOf(column.day), x: column.x })),
    };
  }, [days, order, unassignedLabel, columnLabels]);
  const duration = (value: number) => formatLocalizedCompactDurationFromSeconds(value, language);
  const showHover = (column: ProjectTrendColumn, event: MouseEvent<Element>) => {
    const labelByKey = new Map(view.series.map((item) => [item.key, item.label]));
    setHover({
      dayLabel: column.hoverLabel ?? formatLocalizedDayLabel(column.day, language),
      totalLabel: duration(column.totalSeconds),
      rows: column.segments.map((segment) => ({ key: segment.key, label: labelByKey.get(segment.key) ?? unassignedLabel, color: segment.color, durationLabel: duration(segment.seconds) })),
      x: event.clientX,
      y: event.clientY,
    });
  };
  return (
    <>
      <ProjectTrendBars view={view} ariaLabel={ariaLabel} onHover={showHover} onLeave={() => setHover(null)} onSelect={onSelectColumn ? (column) => { setHover(null); onSelectColumn(column.day); } : undefined} />
      {hover ? (
        <div ref={hoverRef} className="ptc-tooltip" style={{ width: "max-content", left: hover.x + 14, top: hover.y + 14 }} role="presentation">
          <div className="ptc-tooltip__head">
            <span className="ptc-tooltip__day">{hover.dayLabel}</span>
            <span className="ptc-tooltip__total">{hover.totalLabel}</span>
          </div>
          {hover.rows.length > 0 ? (
            <ul className="ptc-tooltip__rows">
              {hover.rows.map((row) => (
                <li className="ptc-tooltip__row" key={row.key}>
                  <span className="ptc-tooltip__dot" style={{ background: row.color }} aria-hidden="true" />
                  <span className="ptc-tooltip__name">{row.label}</span>
                  <span className="ptc-tooltip__dur">{row.durationLabel}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}


/** The team page's footnote (both tabs): the shield line naming what the team sees. */
export function TeamPrivacyNote({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <p className="team-footnote">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.2 2.9 7.6 7 8.6 4.1-1 7-4.4 7-8.6V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
      {children}
    </p>
  );
}

