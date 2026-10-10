import { useMemo, useState } from "react";
import type { MouseEvent } from "react";

import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDateRangeLabel, formatLocalizedDayLabel } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { ProjectTrendColumn } from "../projects/projectTrendView";
import { buildTeamTrendModel } from "./teamTrendView";
import type { TeamProject, TeamProjectMemberRow, TeamProjectMixRow } from "./teamTypes";
import { teamWindowCaption, teamWindowDayCount } from "./teamWindowCaption";
import type { TeamProjectsWindow } from "./useTeamProjects";
import "../projects/project-trend-chart.css";
import { ActionLabel } from "../../components/ActionLabel";
import { ProjectTrendBars } from "../projects/ProjectTrendBars";
import { isOwnTeamMemberRow, teamMemberGroupKey } from "./teamMemberIdentity";

export type TeamDashboardsViewProps = {
  readonly window: TeamProjectsWindow;
  /** Whether the window ends today; earlier windows name their dates. */
  readonly isLatestWindow: boolean;
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
  readonly key: string;
  readonly name: string;
  readonly isYou: boolean;
  readonly totalSeconds: number;
  readonly segments: readonly {
    readonly projectId: string;
    readonly color: string;
    readonly pct: number;
    readonly title: string;
  }[];
}

const FALLBACK_COLOR = "#9ca3af";


/**
 * Shared-project dashboards: Team mix ranked bars, the over-time stacked area,
 * window totals, and the per-member split. The member split intentionally shows
 * percentages only — published per-project totals stay aggregate, and nothing
 * here renders another member's absolute hours.
 */
export function TeamDashboardsView({
  window: timeWindow,
  isLatestWindow,
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
  const { effectiveLanguage, t } = useLocalization();
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
    const byMember = new Map<string, { name: string; isYou: boolean; bucket: Map<string, number> }>();
    for (const row of members) {
      if (!activeProjectIds.has(row.organization_project_id)) continue;
      const seconds = Number.isFinite(row.seconds) ? Math.max(0, row.seconds) : 0;
      if (seconds <= 0) continue;
      nameByProjectId.set(row.organization_project_id, row.project_name);
      const key = teamMemberGroupKey(row);
      const entry = byMember.get(key) ?? { name: row.member_display_name, isYou: false, bucket: new Map<string, number>() };
      const bucket = entry.bucket;
      bucket.set(row.organization_project_id, (bucket.get(row.organization_project_id) ?? 0) + seconds);
      byMember.set(key, { ...entry, isYou: entry.isYou || isOwnTeamMemberRow(row, memberDisplayName) });
    }
    return [...byMember.entries()]
      .map(([key, { name, isYou, bucket }]) => {
        const total = [...bucket.values()].reduce((sum, seconds) => sum + seconds, 0);
        const segments = [...bucket.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([projectId, seconds]) => {
            const pct = total > 0 ? (seconds / total) * 100 : 0;
            const projectName = nameByProjectId.get(projectId) ?? t("team.dashboard.projectFallback");
            return {
              projectId,
              color: colorByProjectId.get(projectId) ?? FALLBACK_COLOR,
              pct,
              title: `${projectName} · ${Math.round(pct)}%`,
            };
          });
        return { key, name, isYou, totalSeconds: total, segments };
      })
      .sort((left, right) => right.totalSeconds - left.totalSeconds || left.name.localeCompare(right.name));
  }, [colorByProjectId, memberDisplayName, members, projects, slices, t]);

  const dayCount = teamWindowDayCount(timeWindow);
  // Team totals are stored per day, so the Day view has a single data point.
  const isSingleDay = dayCount <= 1;
  const windowShortLabel = teamWindowCaption(timeWindow, isLatestWindow, effectiveLanguage, t);
  // The member count comes from the team list, which can lag a fresh join; never
  // show more people sharing than the team has.
  const sharingLabel = memberCount > 0
    ? t("team.dashboard.sharingCount", { sharing: memberRows.length, total: Math.max(memberCount, memberRows.length) })
    : `${memberRows.length}`;
  const activeProjectCount = projects.filter((project) => project.status === "active").length;
  const localizedWindowLabel = formatLocalizedDateRangeLabel(timeWindow.start_date, timeWindow.end_date, effectiveLanguage);

  function showHover(column: ProjectTrendColumn, event: MouseEvent<Element>) {
    const labelByKey = new Map(view.series.map((item) => [item.key, item.label]));
    setHover({
      dayLabel: formatLocalizedDayLabel(column.day, effectiveLanguage),
      totalLabel: column.segments.length === 0 ? t("team.dashboard.noSharedTime") : formatLocalizedCompactDurationFromSeconds(column.totalSeconds, effectiveLanguage),
      rows: column.segments.map((segment) => ({
        key: segment.key,
        label: labelByKey.get(segment.key) ?? t("team.dashboard.projectFallback"),
        color: segment.color,
        durationLabel: formatLocalizedCompactDurationFromSeconds(segment.seconds, effectiveLanguage),
      })),
      x: event.clientX,
      y: event.clientY,
    });
  }

  return (
    <section className="team-data-panel team-grid" aria-label={t("team.dashboard.aria")}>
      <div className="team-dash-section team-card team-card--side editorial-panel editorial-panel--soft insight-chart-panel" aria-labelledby="team-mix-heading">
        <div className="insight-panel-head">
          <span className="label-mono" id="team-mix-heading">{t("team.dashboard.mix")}</span>
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
                <div className="team-rank-row" key={slice.projectId} title={`${slice.name} · ${formatLocalizedCompactDurationFromSeconds(slice.seconds, effectiveLanguage)} (${pct}%)`}>
                  <div className="team-rank-meta">
                    <span className="team-rank-name">
                      <span className="team-legend-swatch" style={{ background: slice.color }} />
                      {slice.name}
                    </span>
                    <span className="team-rank-val">
                      <b>{formatLocalizedCompactDurationFromSeconds(slice.seconds, effectiveLanguage)}</b>
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
            {loading ? t("team.dashboard.loadingTime") : t("team.dashboard.emptyTime")}
          </div>
        )}
      </div>

      <div className="team-dash-section team-card team-card--chart editorial-panel editorial-panel--soft insight-chart-panel ptc-panel" aria-labelledby="team-trend-heading">
        <div className="insight-panel-head">
          <span className="label-mono" id="team-trend-heading">{t("team.dashboard.sharedTime", { range: localizedWindowLabel })}</span>
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
          <ProjectTrendBars
            view={view}
            ariaLabel={isSingleDay ? t("team.dashboard.daySplitAria", { day: localizedWindowLabel }) : t("team.dashboard.chartAria")}
            onHover={showHover}
            onLeave={() => setHover(null)}
          />
        ) : (
          <div className="team-empty">{t("team.dashboard.emptyTimeline")}</div>
        )}
      </div>

      <div className="team-dash-section team-card team-card--stats editorial-panel editorial-panel--soft insight-chart-panel" aria-label={t("team.dashboard.totalsAria")}>
        <div className="insight-panel-head">
          <span className="label-mono">{t("team.dashboard.totals")}</span>
          <button type="button" className="app-btn app-btn--quiet app-btn--compact" onClick={onRefresh} disabled={loading} aria-busy={loading}>
            <ActionLabel busy={loading}>{t("team.dashboard.refresh")}</ActionLabel>
          </button>
        </div>
        <div className="team-stats-stack">
          <div className="team-stat team-stat--lead">
            <span className="label-mono">{t("team.dashboard.shared", { range: windowShortLabel })}</span>
            <strong>{formatLocalizedCompactDurationFromSeconds(totalSeconds, effectiveLanguage)}</strong>
          </div>
          <div className="team-stat">
            <span className="label-mono">{t("team.dashboard.activeProjects")}</span>
            <strong>{activeProjectCount}</strong>
          </div>
          <div className="team-stat">
            <span className="label-mono">{t("team.dashboard.sharing")}</span>
            <strong>{sharingLabel}</strong>
          </div>
        </div>
        {error ? <p className="team-message team-message--error">{error}</p> : null}
      </div>

      <div className="team-dash-section team-card team-card--members editorial-panel editorial-panel--soft insight-chart-panel" aria-labelledby="team-members-heading">
        <div className="insight-panel-head">
          <span className="label-mono" id="team-members-heading">{t("team.dashboard.byMember")}</span>
        </div>
        {memberRows.length === 0 ? (
          <div className="team-empty">{t("team.dashboard.noMemberBreakdown")}</div>
        ) : (
          <div className="team-members">
            {memberRows.map((member) => {
              const lead = member.segments[0];
              return (
                <div className="team-member" key={member.key}>
                  <span className="team-member__avatar" aria-hidden="true">{member.name.trim().charAt(0).toUpperCase() || "?"}</span>
                  <span className="team-member__name">
                    <strong>{member.name}</strong>
                    {member.isYou ? <span className="team-you-chip">{t("team.dashboard.you")}</span> : null}
                  </span>
                  <div className="team-member__bar" role="img" aria-label={t("team.dashboard.memberSplitAria", { name: member.name })}>
                    {member.segments.map((segment) => (
                      <span
                        className="team-member__seg"
                        style={{ width: `${segment.pct}%`, background: segment.color }}
                        title={segment.title}
                        key={segment.projectId}
                      />
                    ))}
                  </div>
                  {/* The member's largest share; the full split is on hover. Percentages
                      only — another member's absolute hours are never shown. */}
                  <span className="team-member__lead" title={lead?.title}>
                    {lead ? <><span className="team-legend-swatch" style={{ background: lead.color }} aria-hidden="true" />{Math.round(lead.pct)}%</> : null}
                  </span>
                </div>
              );
            })}
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
