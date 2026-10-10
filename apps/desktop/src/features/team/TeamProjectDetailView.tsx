import { useMemo, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";

import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDateRangeLabel, formatLocalizedDayLabel } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { ProjectTrendChartSkeleton } from "../projects/ProjectTrendChartSkeleton";
import type { ProjectTrendColumn } from "../projects/projectTrendView";
import { buildTeamTrendModel } from "./teamTrendView";
import { buildTeamDayPoints } from "./teamDayPoints";
import { isOwnTeamMemberRow, teamMemberGroupKey } from "./teamMemberIdentity";
import type { TeamProject, TeamProjectMemberRow, TeamProjectMixRow } from "./teamTypes";
import { teamWindowCaption, teamWindowDayCount } from "./teamWindowCaption";
import type { TeamProjectsWindow } from "./useTeamProjects";
import "../projects/project-trend-chart.css";

type ScaleTickStyle = CSSProperties & { readonly "--ptc-scale-y": string };
type AxisTickStyle = CSSProperties & { readonly "--ptc-axis-x": string };
type DayPointStyle = CSSProperties & { readonly "--team-day-x": string; readonly "--team-day-y": string; readonly "--team-day-color": string };

interface HoverState {
  readonly dayLabel: string;
  readonly totalLabel: string;
  readonly x: number;
  readonly y: number;
}

interface MemberShareRow {
  readonly key: string;
  readonly name: string;
  readonly isYou: boolean;
  readonly pct: number;
  readonly fillPct: number;
}

export interface TeamProjectDetailViewProps {
  readonly project: TeamProject;
  readonly mix: readonly TeamProjectMixRow[];
  readonly members: readonly TeamProjectMemberRow[];
  readonly window: TeamProjectsWindow;
  /** Whether the window ends today; earlier windows name their dates. */
  readonly isLatestWindow: boolean;
  readonly memberDisplayName: string | null;
  readonly loading: boolean;
  readonly actionLoading: boolean;
  readonly onBack: () => void;
  readonly onEdit: (project: TeamProject) => void;
  readonly onArchive: (projectId: string, archived: boolean) => void;
}

/**
 * Shared-project drill-down: definition header (description + edit/archive),
 * the project's shared-time trend over the selected window, and the member
 * split. Member rows stay percentage-only — published per-project totals are
 * team aggregates, and nothing here exposes another member's absolute hours.
 */
export function TeamProjectDetailView({
  project,
  mix,
  members,
  window: timeWindow,
  isLatestWindow,
  memberDisplayName,
  loading,
  actionLoading,
  onBack,
  onEdit,
  onArchive,
}: TeamProjectDetailViewProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const [hover, setHover] = useState<HoverState | null>(null);
  const isArchived = project.status === "archived";

  const projectMix = useMemo(
    () => mix.filter((row) => row.organization_project_id === project.id),
    [mix, project.id],
  );
  const trend = useMemo(() => buildTeamTrendModel(projectMix, timeWindow), [projectMix, timeWindow]);
  const { view, totalSeconds } = trend;
  const hasData = totalSeconds > 0;

  const teamTotalSeconds = useMemo(
    () => mix.reduce((sum, row) => sum + (Number.isFinite(row.seconds) ? Math.max(0, row.seconds) : 0), 0),
    [mix],
  );
  const sharePct = teamTotalSeconds > 0 ? Math.round((totalSeconds / teamTotalSeconds) * 100) : 0;

  // Percentage-only member split of this project's shared time.
  const memberRows = useMemo<readonly MemberShareRow[]>(() => {
    const totals = new Map<string, { name: string; isYou: boolean; seconds: number }>();
    for (const row of members) {
      if (row.organization_project_id !== project.id) continue;
      const seconds = Number.isFinite(row.seconds) ? Math.max(0, row.seconds) : 0;
      if (seconds <= 0) continue;
      const key = teamMemberGroupKey(row);
      const entry = totals.get(key);
      totals.set(key, {
        name: row.member_display_name,
        isYou: (entry?.isYou ?? false) || isOwnTeamMemberRow(row, memberDisplayName),
        seconds: (entry?.seconds ?? 0) + seconds,
      });
    }
    const total = [...totals.values()].reduce((sum, value) => sum + value.seconds, 0);
    const ranked = [...totals.entries()].sort((left, right) => right[1].seconds - left[1].seconds || left[1].name.localeCompare(right[1].name));
    const maxSeconds = ranked[0]?.[1].seconds ?? 0;
    return ranked.map(([key, entry]) => ({
      key,
      name: entry.name,
      isYou: entry.isYou,
      pct: total > 0 ? Math.round((entry.seconds / total) * 100) : 0,
      fillPct: maxSeconds > 0 ? Math.max((entry.seconds / maxSeconds) * 100, 3) : 0,
    }));
  }, [members, project.id, memberDisplayName]);

  const dayCount = teamWindowDayCount(timeWindow);
  // Team totals are stored per day, so the Day view has a single data point.
  const isSingleDay = dayCount <= 1;
  const dayPoints = isSingleDay && view.columns[0] ? buildTeamDayPoints(view.columns[0], view.bounds) : [];
  const dayGuidePath = dayPoints.length > 0 ? `M ${dayPoints[0]!.x} ${view.bounds.bottom} V ${Math.min(...dayPoints.map((point) => point.y))}` : "";
  const windowCaption = teamWindowCaption(timeWindow, isLatestWindow, effectiveLanguage, t);
  const localizedWindowLabel = formatLocalizedDateRangeLabel(timeWindow.start_date, timeWindow.end_date, effectiveLanguage);
  const { left, right, top, bottom } = view.bounds;

  function showHover(column: ProjectTrendColumn, event: MouseEvent<Element>) {
    setHover({
      dayLabel: formatLocalizedDayLabel(column.day, effectiveLanguage),
      totalLabel: column.totalSeconds > 0
        ? formatLocalizedCompactDurationFromSeconds(column.totalSeconds, effectiveLanguage)
        : t("team.dashboard.noSharedTime"),
      x: event.clientX,
      y: event.clientY,
    });
  }

  return (
    <div className="project-detail">
      <button type="button" className="app-btn app-btn--quiet app-btn--compact project-detail__back" onClick={onBack}>
        <span aria-hidden="true">&larr;</span> {t("team.detail.back")}
      </button>

      <div className="team-detail-identity">
        <span className="pt-swatch" style={{ background: project.color }} aria-hidden="true" />
        <h2 className="team-detail-identity__name">{project.name || t("team.projects.untitled")}</h2>
        <span className={`chip${isArchived ? " gray" : " green"}`}>{isArchived ? t("team.projects.archived") : t("team.projects.active")}</span>
      </div>

      <section className="editorial-panel editorial-panel--soft insight-chart-panel project-detail__head-panel" aria-label={t("team.detail.projectAria", { name: project.name })}>
        <div className="project-detail__head">
          <span className="label-mono">{t("projects.detail.overview")}</span>
          {project.can_manage ? (
            <div className="project-detail__actions">
              <button type="button" className="app-btn app-btn--secondary" disabled={actionLoading} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onEdit(project); }}>{t("team.projects.edit")}</button>
              <button type="button" className="app-btn app-btn--secondary" disabled={actionLoading} onClick={() => onArchive(project.id, !isArchived)}>
                {isArchived ? t("team.projects.restore") : t("team.projects.archive")}
              </button>
            </div>
          ) : null}
        </div>
        {project.description.trim() ? (
          <p className="project-detail__desc">{project.description}</p>
        ) : (
          <p className="project-detail__desc project-detail__desc--empty">{t("team.detail.emptyDescription")}</p>
        )}
        <div className="project-detail__stats" role="group" aria-label={t("team.detail.statsAria")}>
          <div className="project-detail__stat">
            <span className="label-mono">{t("team.detail.teamTime", { range: windowCaption })}</span>
            <strong>{hasData ? formatLocalizedCompactDurationFromSeconds(totalSeconds, effectiveLanguage) : "—"}</strong>
          </div>
          <div className="project-detail__stat">
            <span className="label-mono">{t("team.detail.share")}</span>
            <strong>{hasData ? `${sharePct}%` : "—"}</strong>
          </div>
          <div className="project-detail__stat">
            <span className="label-mono">{t("team.detail.contributors")}</span>
            <strong>{memberRows.length}</strong>
          </div>
        </div>
      </section>

      {loading && !hasData ? (
        <ProjectTrendChartSkeleton
          windowLabel={localizedWindowLabel}
          legendProjects={[{ id: project.id, name: project.name, color: project.color }]}
          isDayMode={false}
          startDay={timeWindow.start_date}
          endDay={timeWindow.end_date}
          startOfDayMinutes={0}
        />
      ) : (
        <section className="editorial-panel editorial-panel--soft insight-chart-panel ptc-panel" aria-label={t("team.detail.trendAria")}>
          <div className="insight-panel-head">
            <span className="label-mono">{t("team.dashboard.sharedTime", { range: localizedWindowLabel })}</span>
          </div>
          {hasData ? (
            <div className="ptc-chart">
              <div className="ptc-plot">
                <svg
                  className="ptc-svg"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={isSingleDay ? t("team.dashboard.daySplitAria", { day: localizedWindowLabel }) : t("team.detail.byDayAria", { name: project.name })}
                >
                  <path className="ptc-grid" d={view.gridPath} />
                  {isSingleDay ? (
                  <path className="team-day-guide" d={dayGuidePath} />
                  ) : (<>
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
                </>)}
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
                {dayPoints.map((point) => (
                  <span className="team-day-point" style={{ "--team-day-x": `${point.x}%`, "--team-day-y": `${point.y}%`, "--team-day-color": point.color } as DayPointStyle} aria-hidden="true" key={point.key}>
                    <span className="team-day-point__value">{formatLocalizedCompactDurationFromSeconds(totalSeconds, effectiveLanguage)}</span>
                  </span>
                ))}
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
            <div className="team-empty">{t("team.detail.emptyTime")}</div>
          )}
        </section>
      )}

      <section className="editorial-panel editorial-panel--soft insight-chart-panel" aria-label={t("team.detail.memberSplitAria", { name: project.name })}>
        <div className="insight-panel-head">
          <span className="label-mono">{t("team.detail.byMember", { range: windowCaption })}</span>
        </div>
        {memberRows.length === 0 ? (
          <div className="team-empty">{t("team.dashboard.noMemberBreakdown")}</div>
        ) : (
          <div className="project-detail__sources">
            {memberRows.map((member) => (
              <div className="project-detail__source" key={member.key} title={t("team.detail.memberTitle", { name: member.name, percent: member.pct })}>
                <div className="project-detail__source-meta">
                  <span className="team-detail-member">
                    <span className="team-member__avatar" aria-hidden="true">{member.name.trim().charAt(0).toUpperCase() || "?"}</span>
                    <span className="team-detail-member__name">{member.name}</span>
                    {member.isYou ? <span className="team-you-chip">{t("team.dashboard.you")}</span> : null}
                  </span>
                  <span className="project-detail__source-val">
                    <span>{member.pct}%</span>
                  </span>
                </div>
                <span className="project-detail__source-bar">
                  <span style={{ width: `${member.fillPct}%`, background: project.color }} />
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {hover ? (
        <div className="ptc-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="presentation">
          <div className="ptc-tooltip__head">
            <span className="ptc-tooltip__day">{hover.dayLabel}</span>
            <span className="ptc-tooltip__total">{hover.totalLabel}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
