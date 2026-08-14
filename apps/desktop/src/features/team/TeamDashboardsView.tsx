import { useMemo, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";

import { formatCompactDurationFromSeconds, formatDayLabel } from "../../lib/formatting";
import type { ProjectTrendColumn } from "../projects/projectTrendView";
import { buildTeamTrendModel } from "./teamTrendView";
import type { TeamProject, TeamProjectMemberRow, TeamProjectMixRow } from "./teamTypes";
import type { TeamProjectsWindow } from "./useTeamProjects";
import "../projects/project-trend-chart.css";

export type TeamDashboardsViewProps = {
  readonly window: TeamProjectsWindow;
  readonly projects: readonly TeamProject[];
  readonly mix: readonly TeamProjectMixRow[];
  readonly members: readonly TeamProjectMemberRow[];
  readonly memberCount: number;
  readonly memberDisplayName: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly publishNote: string | null;
  readonly onRefresh: () => void;
};

interface HoverRow {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly durationLabel: string;
}

interface HoverState {
  readonly dayLabel: string;
  readonly totalLabel: string;
  readonly rows: readonly HoverRow[];
  readonly x: number;
  readonly y: number;
}

interface MemberBarRow {
  readonly name: string;
  readonly isYou: boolean;
  readonly totalSeconds: number;
  readonly segments: readonly {
    readonly projectId: string;
    readonly color: string;
    readonly pct: number;
    readonly label: string;
    readonly title: string;
  }[];
}

const FALLBACK_COLOR = "#9ca3af";

type ScaleTickStyle = CSSProperties & { readonly "--ptc-scale-y": string };
type AxisTickStyle = CSSProperties & { readonly "--ptc-axis-x": string };

function windowDayCount(window: TeamProjectsWindow): number {
  const start = Date.parse(`${window.start_date}T00:00:00Z`);
  const end = Date.parse(`${window.end_date}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.round((end - start) / 86_400_000) + 1;
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part[0]!.toUpperCase()).join("");
  return initials || "?";
}

/**
 * Shared-project dashboards: Team mix ranked bars, the over-time stacked area,
 * window totals, and the per-member split. The member split intentionally shows
 * percentages only — published per-project totals stay aggregate, and nothing
 * here renders another member's absolute hours.
 */
export function TeamDashboardsView({
  window: timeWindow,
  projects,
  mix,
  members,
  memberCount,
  memberDisplayName,
  loading,
  error,
  publishNote,
  onRefresh,
}: TeamDashboardsViewProps) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const trend = useMemo(() => buildTeamTrendModel(mix, timeWindow), [mix, timeWindow]);
  const { view, slices, totalSeconds } = trend;
  const hasMix = slices.length > 0 && totalSeconds > 0;
  const maxSliceSeconds = slices.reduce((max, slice) => Math.max(max, slice.seconds), 0);

  const colorByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) map.set(project.id, project.color);
    for (const slice of slices) if (!map.has(slice.projectId)) map.set(slice.projectId, slice.color);
    return map;
  }, [projects, slices]);

  const memberRows = useMemo<readonly MemberBarRow[]>(() => {
    const activeProjectIds = new Set(projects.filter((project) => project.status === "active").map((project) => project.id));
    for (const slice of slices) activeProjectIds.add(slice.projectId);
    const nameByProjectId = new Map<string, string>();
    const byMember = new Map<string, Map<string, number>>();
    for (const row of members) {
      if (!activeProjectIds.has(row.organization_project_id)) continue;
      const seconds = Number.isFinite(row.seconds) ? Math.max(0, row.seconds) : 0;
      if (seconds <= 0) continue;
      nameByProjectId.set(row.organization_project_id, row.project_name);
      const bucket = byMember.get(row.member_display_name) ?? new Map<string, number>();
      bucket.set(row.organization_project_id, (bucket.get(row.organization_project_id) ?? 0) + seconds);
      byMember.set(row.member_display_name, bucket);
    }
    return [...byMember.entries()]
      .map(([name, bucket]) => {
        const total = [...bucket.values()].reduce((sum, seconds) => sum + seconds, 0);
        const segments = [...bucket.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([projectId, seconds]) => {
            const pct = total > 0 ? (seconds / total) * 100 : 0;
            const projectName = nameByProjectId.get(projectId) ?? "Project";
            return {
              projectId,
              color: colorByProjectId.get(projectId) ?? FALLBACK_COLOR,
              pct,
              label: pct >= 9 ? `${Math.round(pct)}%` : "",
              title: `${projectName} · ${Math.round(pct)}%`,
            };
          });
        return { name, isYou: name === memberDisplayName, totalSeconds: total, segments };
      })
      .sort((left, right) => right.totalSeconds - left.totalSeconds || left.name.localeCompare(right.name));
  }, [colorByProjectId, memberDisplayName, members, projects, slices]);

  const dayCount = windowDayCount(timeWindow);
  const windowShortLabel = dayCount <= 1 ? "Today" : `${dayCount} days`;
  const sharingLabel = memberCount > 0 ? `${memberRows.length} of ${memberCount}` : `${memberRows.length}`;
  const activeProjectCount = projects.filter((project) => project.status === "active").length;
  const { left, right, top, bottom } = view.bounds;

  function showHover(column: ProjectTrendColumn, event: MouseEvent<SVGRectElement>) {
    const labelByKey = new Map(view.series.map((item) => [item.key, item.label]));
    setHover({
      dayLabel: formatDayLabel(column.day),
      totalLabel: column.segments.length === 0 ? "No shared time" : formatCompactDurationFromSeconds(column.totalSeconds),
      rows: column.segments.map((segment) => ({
        key: segment.key,
        label: labelByKey.get(segment.key) ?? "Project",
        color: segment.color,
        durationLabel: formatCompactDurationFromSeconds(segment.seconds),
      })),
      x: event.clientX,
      y: event.clientY,
    });
  }

  return (
    <section className="team-data-panel team-grid" aria-label="Shared project dashboards">
      <div className="team-dash-section team-card team-card--side editorial-panel editorial-panel--soft insight-chart-panel" aria-labelledby="team-mix-heading">
        <div className="insight-panel-head">
          <span className="label-mono" id="team-mix-heading">Team mix</span>
        </div>

        {publishNote ? (
          <p className="team-pubnote">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            {publishNote}
          </p>
        ) : null}

        {hasMix ? (
          <div className="team-rank">
            {slices.map((slice) => {
              const pct = totalSeconds > 0 ? Math.round((slice.seconds / totalSeconds) * 100) : 0;
              const barWidth = maxSliceSeconds > 0 ? (slice.seconds / maxSliceSeconds) * 100 : 0;
              return (
                <div className="team-rank-row" key={slice.projectId} title={`${slice.name} · ${formatCompactDurationFromSeconds(slice.seconds)} (${pct}%)`}>
                  <div className="team-rank-meta">
                    <span className="team-rank-name">
                      <span className="team-legend-swatch" style={{ background: slice.color }} />
                      {slice.name}
                    </span>
                    <span className="team-rank-val">
                      <b>{formatCompactDurationFromSeconds(slice.seconds)}</b>
                      <span>{pct}%</span>
                    </span>
                  </div>
                  <span className="team-rank-track">
                    <span className="team-rank-fill" style={{ width: `${Math.max(barWidth, 3)}%`, background: slice.color }} />
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="team-empty">
            {loading ? "Loading shared time…" : "No shared project time yet — define shared projects, then share your time from Team settings."}
          </div>
        )}
      </div>

      <div className="team-dash-section team-card team-card--chart editorial-panel editorial-panel--soft insight-chart-panel ptc-panel" aria-labelledby="team-trend-heading">
        <div className="insight-panel-head">
          <span className="label-mono" id="team-trend-heading">Shared time &middot; {view.spanLabel}</span>
          <div className="insight-panel-head__legend">
            {slices.slice(0, 6).map((slice) => (
              <span className="chip ptc-chip" key={slice.projectId}>
                <span className="sw" style={{ background: slice.color }} />
                {slice.name}
              </span>
            ))}
          </div>
        </div>
        {hasMix ? (
          <div className="ptc-chart">
            <div className="ptc-plot">
              <svg
                className="ptc-svg"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="img"
                aria-label="Stacked shared project time by day"
              >
                <path className="ptc-grid" d={view.gridPath} />
                <g className="ptc-areas">
                  {view.areaBands.map((band) => (
                    <path className="ptc-area" d={band.areaPath} fill={band.color} key={`area-${band.key}`} />
                  ))}
                </g>
                <g className="ptc-lines">
                  {view.areaBands.map((band) => (
                    <path className="ptc-line" d={band.linePath} stroke={band.color} key={`line-${band.key}`} />
                  ))}
                </g>
                <g className="ptc-hits">
                  {view.columns.map((column, index) => {
                    const previous = view.columns[index - 1];
                    const next = view.columns[index + 1];
                    const x0 = previous ? (previous.x + column.x) / 2 : left;
                    const x1 = next ? (column.x + next.x) / 2 : right;
                    return (
                      <rect
                        className="ptc-hit"
                        x={x0}
                        y={top}
                        width={Math.max(0, x1 - x0)}
                        height={bottom - top}
                        key={column.day}
                        onMouseEnter={(event) => showHover(column, event)}
                        onMouseMove={(event) => showHover(column, event)}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </g>
              </svg>
              <div className="ptc-scale" aria-hidden="true">
                {view.yAxis.map((tick) => (
                  <span style={{ "--ptc-scale-y": `${tick.y}%` } as ScaleTickStyle} key={tick.label}>{tick.label}</span>
                ))}
              </div>
            </div>
            <div className="ptc-axis" aria-hidden="true">
              {view.axisTicks.map((tick) => (
                <span style={{ "--ptc-axis-x": `${tick.x}%` } as AxisTickStyle} key={tick.id}>{tick.label}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="team-empty">No timeline yet — shared time appears here once members share.</div>
        )}
      </div>

      <div className="team-dash-section team-card team-card--stats editorial-panel editorial-panel--soft insight-chart-panel" aria-label="Team totals">
        <div className="insight-panel-head">
          <span className="label-mono">Totals</span>
          <button type="button" className="app-btn app-btn--quiet app-btn--compact" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="team-stats-stack">
          <div className="team-stat team-stat--lead">
            <span className="label-mono">Shared · {windowShortLabel}</span>
            <strong>{formatCompactDurationFromSeconds(totalSeconds)}</strong>
          </div>
          <div className="team-stat">
            <span className="label-mono">Active projects</span>
            <strong>{activeProjectCount}</strong>
          </div>
          <div className="team-stat">
            <span className="label-mono">Sharing</span>
            <strong>{sharingLabel}</strong>
          </div>
        </div>
        {error ? <p className="team-message team-message--error">{error}</p> : null}
      </div>

      <div className="team-dash-section team-card team-card--members editorial-panel editorial-panel--soft insight-chart-panel" aria-labelledby="team-members-heading">
        <div className="insight-panel-head">
          <span className="label-mono" id="team-members-heading">By member</span>
        </div>
        {memberRows.length === 0 ? (
          <div className="team-empty">No member breakdown yet.</div>
        ) : (
          <div className="team-members">
            {memberRows.map((member) => (
              <div className="team-member" key={member.name}>
                <span className="team-member__avatar" aria-hidden="true">{initialsFor(member.name)}</span>
                <span className="team-member__name">
                  <strong>{member.name}</strong>
                  {member.isYou ? <span className="team-you-chip">You</span> : null}
                </span>
                <div className="team-member__bar" role="img" aria-label={`${member.name} project split`}>
                  {member.segments.map((segment) => (
                    <span
                      className="team-member__seg"
                      style={{ width: `${segment.pct}%`, background: segment.color }}
                      title={segment.title}
                      key={segment.projectId}
                    >
                      <span className="team-member__seg-label">{segment.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {hover ? (
        <div className="ptc-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="presentation">
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
    </section>
  );
}

export default TeamDashboardsView;
