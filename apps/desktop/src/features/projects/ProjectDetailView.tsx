import { useMemo, useState } from "react";
import type { ActivitySegment, Project, ProjectInput } from "@drifty/domain";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { ProjectEditorModal } from "./ProjectEditorModal";
import { ProjectTrendChart } from "./ProjectTrendChart";
import { ProjectTrendChartSkeleton } from "./ProjectTrendChartSkeleton";
import { useLocalization } from "../localization/LocalizationContext";

interface SourceRow {
  readonly key: string;
  readonly label: string;
  readonly seconds: number;
  readonly sharePct: number;
  readonly fillPct: number;
}

export interface ProjectDetailViewProps {
  readonly project: Project;
  readonly projects: readonly Project[];
  /** Segments + attribution for the currently loaded trend window. */
  readonly trendSegments: readonly ActivitySegment[];
  readonly trendProjectBySegmentId: ReadonlyMap<string, string>;
  readonly trendReady: boolean;
  readonly windowDays: number;
  readonly startDay: string;
  readonly endDay: string;
  readonly isDayMode: boolean;
  readonly startOfDayMinutes: number;
  /** e.g. "Last 7 days" / "Today" — matches the range controls. */
  readonly totalCaption: string;
  readonly windowLabel: string;
  readonly totalSeconds: number;
  /** Tracked seconds attributed to ANY project in the window (for the share stat). */
  readonly windowProjectSeconds: number;
  readonly lastActivityLabel: string;
  readonly busy?: boolean;
  readonly onSave: (input: ProjectInput) => Promise<boolean> | boolean;
}

/**
 * Per-project drill-down: header (identity + description + edit/archive), the
 * project's own time trend over the selected window, and where that time came
 * from (top apps/sites). Uses only the window data the Projects page already
 * loads — no extra fetches.
 */
export function ProjectDetailView({
  project,
  projects,
  trendSegments,
  trendProjectBySegmentId,
  trendReady,
  windowDays,
  startDay,
  endDay,
  isDayMode,
  startOfDayMinutes,
  totalCaption,
  windowLabel,
  totalSeconds,
  windowProjectSeconds,
  lastActivityLabel,
  busy = false,
  onSave,
}: ProjectDetailViewProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const [editorOpen, setEditorOpen] = useState(false);
  const isArchived = project.status === "archived";

  // Only this project's segments — the chart shows a single band scaled to it.
  const { projectSegments, projectAssignments } = useMemo(() => {
    const segments: ActivitySegment[] = [];
    const assignments = new Map<string, string>();
    for (const segment of trendSegments) {
      if (trendProjectBySegmentId.get(segment.id) !== project.id) continue;
      segments.push(segment);
      assignments.set(segment.id, project.id);
    }
    return { projectSegments: segments, projectAssignments: assignments };
  }, [trendSegments, trendProjectBySegmentId, project.id]);

  // Where the project's time came from: sites by domain, otherwise apps.
  const sources = useMemo<readonly SourceRow[]>(() => {
    const totals = new Map<string, { label: string; seconds: number }>();
    for (const segment of projectSegments) {
      const label = segment.siteDomain ?? segment.appName;
      // Rows are identified by the label users actually see. The old app/domain
      // keys could render duplicate labels (for example two separate "drifty"
      // rows), which made the breakdown look like duplicated data.
      const key = label.trim().toLowerCase() || "unknown";
      const existing = totals.get(key);
      totals.set(key, { label, seconds: (existing?.seconds ?? 0) + segment.durationSeconds });
    }
    const ranked = [...totals.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((left, right) => right.seconds - left.seconds || left.label.localeCompare(right.label))
      .slice(0, 6);
    const maxSeconds = ranked[0]?.seconds ?? 0;
    return ranked.map((row) => ({
      key: row.key,
      label: row.label,
      seconds: row.seconds,
      sharePct: totalSeconds > 0 ? Math.round((row.seconds / totalSeconds) * 100) : 0,
      fillPct: maxSeconds > 0 ? Math.max((row.seconds / maxSeconds) * 100, 3) : 0,
    }));
  }, [projectSegments, totalSeconds]);

  const sharePct = windowProjectSeconds > 0 ? Math.round((totalSeconds / windowProjectSeconds) * 100) : 0;

  const toggleArchive = () => {
    onSave({
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      status: isArchived ? "active" : "archived",
    });
  };

  return (
    <div className="project-detail">
      <section className="editorial-panel editorial-panel--soft insight-chart-panel project-detail__head-panel" aria-label={`${t("common.project")} ${project.name}`}>
        <div className="project-detail__head">
          <span className="label-mono">{t("projects.detail.overview")}</span>
          <div className="project-detail__actions">
            <button type="button" className="app-btn app-btn--secondary" disabled={busy} onClick={() => setEditorOpen(true)}>{t("common.edit")}</button>
            <button type="button" className="app-btn app-btn--secondary" disabled={busy} onClick={toggleArchive}>
              {t(isArchived ? "projects.unarchive" : "projects.archive")}
            </button>
          </div>
        </div>
        {project.description.trim() ? (
          <p className="project-detail__desc">{project.description}</p>
        ) : (
          <p className="project-detail__desc project-detail__desc--empty">{t("projects.detail.noDescription")}</p>
        )}
        <div className="project-detail__stats" role="group" aria-label={t("projects.detail.statsAria")}>
          <div className="project-detail__stat">
            <span className="label-mono">{totalCaption}</span>
            <strong>{totalSeconds > 0 ? formatLocalizedCompactDurationFromSeconds(totalSeconds, effectiveLanguage) : effectiveLanguage === "ko" ? "0분" : "0m"}</strong>
          </div>
          <div className="project-detail__stat">
            <span className="label-mono">{t("projects.detail.assignedShare")}</span>
            <strong>{totalSeconds > 0 ? `${sharePct}%` : "—"}</strong>
          </div>
          <div className="project-detail__stat">
            <span className="label-mono">{t("projects.detail.lastActivity")}</span>
            <strong>{lastActivityLabel}</strong>
          </div>
        </div>
      </section>

      {trendReady ? (
        <ProjectTrendChart
          segments={projectSegments}
          projectBySegmentId={projectAssignments}
          projects={[project]}
          days={windowDays}
          endDay={endDay}
          intraday={isDayMode}
          startOfDayMinutes={startOfDayMinutes}
        />
      ) : (
        <ProjectTrendChartSkeleton
          windowLabel={windowLabel}
          legendProjects={[project]}
          isDayMode={isDayMode}
          startDay={startDay}
          endDay={endDay}
          startOfDayMinutes={startOfDayMinutes}
        />
      )}

      <section className="editorial-panel editorial-panel--soft insight-chart-panel" aria-label={t("projects.detail.topSourcesAria", { name: project.name })}>
        <div className="insight-panel-head">
          <span className="label-mono">{t("projects.detail.whereTimeWent", { caption: totalCaption })}</span>
        </div>
        {sources.length === 0 ? (
          <p className="project-detail__sources-empty">{t("projects.detail.noSources")}</p>
        ) : (
          <div className="project-detail__sources">
            {sources.map((source) => (
              <div className="project-detail__source" key={source.key} title={`${source.label} · ${formatLocalizedCompactDurationFromSeconds(source.seconds, effectiveLanguage)} (${source.sharePct}%)`}>
                <div className="project-detail__source-meta">
                  <span>{source.label}</span>
                  <span className="project-detail__source-val">
                    <b>{formatLocalizedCompactDurationFromSeconds(source.seconds, effectiveLanguage)}</b>
                    <span>{source.sharePct}%</span>
                  </span>
                </div>
                <span className="project-detail__source-bar">
                  <span style={{ width: `${source.fillPct}%`, background: project.color }} />
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {editorOpen ? (
        <ProjectEditorModal
          project={project}
          projects={projects}
          busy={busy}
          onSave={onSave}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}
    </div>
  );
}
