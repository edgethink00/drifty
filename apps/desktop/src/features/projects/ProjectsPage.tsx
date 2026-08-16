import { useEffect, useMemo, useState } from "react";
import type { ActivitySegment, Project, ProjectAssignmentRecord, ProjectInput } from "@drifty/domain";
import { shiftIsoDate } from "@drifty/domain";
import "./projects.css";
import { describeRelativeDay, isoDateFromTimestamp } from "../../lib/formatting";
import { DateNavigator } from "../../components/DateNavigator";
import { ProjectDetailView } from "./ProjectDetailView";
import { ProjectTrendChart } from "./ProjectTrendChart";
import { ProjectTrendChartSkeleton } from "./ProjectTrendChartSkeleton";
import { ProjectsManager } from "./ProjectsManager";
import { ProjectPassConsentModal } from "../classification/ProjectPassConsentModal";
import { analysisModelDisplayLabel, type AnalysisAiSetupState } from "../settings/analysisModelSetup";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const LAST_ACTIVITY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

const PROJECT_LIBRARY_WINDOW_DAYS = 7;

type TrendRangeMode = "day" | "week" | "month";

const RANGE_MODE_OPTIONS: ReadonlyArray<{ readonly key: TrendRangeMode; readonly label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

// Day is a single day rendered as an intraday (30-minute window) chart;
// Week/Month are rolling day-bucketed windows.
function windowDaysFor(mode: TrendRangeMode): number {
  if (mode === "day") return 1;
  if (mode === "month") return 30;
  return 7;
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return iso;
  return `${MONTH_LABELS[(month! - 1 + 12) % 12]} ${day}`;
}

function analysisModelLabel(setup: AnalysisAiSetupState): string {
  if (setup.provider === "cloud") return "Drifty Cloud";
  if (setup.provider === "openrouter") return `OpenRouter · ${analysisModelDisplayLabel(setup.openRouterModel)}`;
  if (setup.provider === "openai") return `OpenAI · ${analysisModelDisplayLabel(setup.openaiModel)}`;
  if (setup.provider === "anthropic") return `Anthropic · ${analysisModelDisplayLabel(setup.anthropicModel)}`;
  return "Custom endpoint";
}

export interface ProjectsPageProps {
  readonly projects: readonly Project[];
  readonly assignments: readonly ProjectAssignmentRecord[];
  readonly selectedDay: string;
  readonly startOfDayMinutes: number;
  readonly daySegments: readonly ActivitySegment[];
  readonly dayProjectBySegmentId: ReadonlyMap<string, string>;
  readonly trendSegments: readonly ActivitySegment[];
  readonly trendProjectBySegmentId: ReadonlyMap<string, string>;
  /** Window the loaded trendSegments actually cover; null until the first load. */
  readonly trendLoadedRange: { readonly startDay: string; readonly endDay: string } | null;
  readonly projectsLoading: boolean;
  readonly running: boolean;
  readonly runError: string | null;
  readonly analysisConnected: boolean;
  readonly analysisSetup: AnalysisAiSetupState;
  readonly consentOpen: boolean;
  readonly consentProviderLabel: string;
  readonly consentIncludesSiteUrl: boolean;
  readonly consentIncludesWindowTitles: boolean;
  readonly consentIncludesContentContext: boolean;
  readonly consentStoresCloudSamples: boolean;
  readonly onTrendWindowChange: (range: { readonly startDay: string; readonly endDay: string }) => void;
  readonly onConfigureModel: () => void;
  readonly onOpenTrends: () => void;
  readonly onSaveProject: (input: ProjectInput) => void;
  readonly onDeleteProject: (id: string) => void;
  readonly onRunAnalysis: () => void;
  readonly onConsentConfirm: () => void;
  readonly onConsentCancel: () => void;
}

interface ProjectMatchingCardProps {
  readonly activeProjectCount: number;
  readonly analysisConnected: boolean;
  readonly analysisSetup: AnalysisAiSetupState;
  readonly layout: "strip" | "card";
  readonly running: boolean;
  readonly onConfigureModel: () => void;
  readonly onRunAnalysis: () => void;
}

function ProjectMatchingCard(props: ProjectMatchingCardProps): JSX.Element {
  const modelLabel = analysisModelLabel(props.analysisSetup);
  return (
    <div
      className={`projects-model-status projects-model-status--${props.layout}${props.analysisConnected ? " is-connected" : " is-disconnected"}`}
      role="group"
      aria-label="Project matching model"
    >
      <div className="projects-model-status__info">
        <span className="projects-model-status__label">Project matching</span>
        <span className="projects-model-status__value">
          {props.layout === "strip"
            ? <>Uses {modelLabel} to refresh the latest 7 days. Live activity classification is configured separately.</>
            : <>Refresh project assignments without changing live activity classification.</>}
        </span>
        {props.layout !== "strip" ? (
          <dl className="projects-model-status__meta">
            <div><dt>Model</dt><dd>{modelLabel}</dd></div>
            <div><dt>Refresh scope</dt><dd>Latest 7 days</dd></div>
          </dl>
        ) : null}
      </div>
      {props.layout === "card" ? (
        <span className={`projects-model-status__readiness${props.analysisConnected ? " is-connected" : ""}`}>
          <span className="projects-model-status__readiness-dot" aria-hidden="true" />
          {props.analysisConnected ? "Ready" : "Setup required"}
        </span>
      ) : (
        <span className={`projects-model-status__chip${props.analysisConnected ? " is-connected" : ""}`}>
          {props.analysisConnected ? "Project model ready" : "Project model setup required"}
        </span>
      )}
      <div className="projects-model-status__actions">
        <button type="button" className="app-btn app-btn--secondary" onClick={props.onConfigureModel}>Model settings</button>
        <button
          type="button"
          className="app-btn app-btn--secondary"
          onClick={props.onRunAnalysis}
          disabled={props.running || !props.analysisConnected || props.activeProjectCount === 0}
        >
          {props.running ? "Refreshing…" : "Refresh latest 7 days"}
        </button>
      </div>
      {props.activeProjectCount === 0 ? (
        <p className="projects-model-status__reason">Create at least one active project before refreshing assignments.</p>
      ) : !props.analysisConnected ? (
        <p className="projects-model-status__reason">Connect a project matching model before refreshing assignments.</p>
      ) : null}
    </div>
  );
}

export function ProjectsPage(props: ProjectsPageProps) {
  const [rangeMode, setRangeMode] = useState<TrendRangeMode>("week");
  const [windowOffset, setWindowOffset] = useState(0);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const activeProjects = props.projects.filter((project) => project.status === "active");
  const selectedProject = selectedProjectId
    ? props.projects.find((project) => project.id === selectedProjectId) ?? null
    : null;

  const windowDays = windowDaysFor(rangeMode);
  const dataWindowDays = selectedProject ? windowDays : PROJECT_LIBRARY_WINDOW_DAYS;
  const isDayMode = rangeMode === "day";
  const endDay = shiftIsoDate(props.selectedDay, -windowOffset * dataWindowDays);
  const startDay = shiftIsoDate(endDay, -(dataWindowDays - 1));
  const atLatestWindow = windowOffset === 0;
  const relativeDayLabel = describeRelativeDay(endDay, props.startOfDayMinutes);
  const windowLabel = isDayMode
    ? relativeDayLabel === "Selected day" ? shortDate(endDay) : relativeDayLabel
    : `${shortDate(startDay)} – ${shortDate(endDay)}`;

  // Tell the shell which window to load trend segments/assignments for.
  const { onTrendWindowChange } = props;
  useEffect(() => {
    onTrendWindowChange({ startDay, endDay });
  }, [onTrendWindowChange, startDay, endDay]);

  // Per-project totals + latest active day within the loaded trend window,
  // for the table's "Total time" / "Last activity" columns.
  const { totalSecondsByProject, lastActivityByProject } = useMemo(() => {
    const totals = new Map<string, number>();
    const lastDays = new Map<string, string>();
    for (const segment of props.trendSegments) {
      const projectId = props.trendProjectBySegmentId.get(segment.id);
      if (!projectId) continue;
      totals.set(projectId, (totals.get(projectId) ?? 0) + segment.durationSeconds);
      const day = isoDateFromTimestamp(segment.startedAt);
      if (day && day > (lastDays.get(projectId) ?? "")) lastDays.set(projectId, day);
    }
    return { totalSecondsByProject: totals, lastActivityByProject: lastDays };
  }, [props.trendSegments, props.trendProjectBySegmentId]);

  // Project rows, overview chart, and assignment refresh share one seven-day window.
  const librarySummaryStartDay = shiftIsoDate(endDay, -(PROJECT_LIBRARY_WINDOW_DAYS - 1));
  const { libraryTotalSecondsByProject, libraryLastActivityByProject } = useMemo(() => {
    const totals = new Map<string, number>();
    const lastDays = new Map<string, string>();
    for (const segment of props.trendSegments) {
      const day = isoDateFromTimestamp(segment.startedAt);
      if (!day || day < librarySummaryStartDay || day > endDay) continue;
      const projectId = props.trendProjectBySegmentId.get(segment.id);
      if (!projectId) continue;
      totals.set(projectId, (totals.get(projectId) ?? 0) + segment.durationSeconds);
      if (day > (lastDays.get(projectId) ?? "")) lastDays.set(projectId, day);
    }
    return { libraryTotalSecondsByProject: totals, libraryLastActivityByProject: lastDays };
  }, [endDay, librarySummaryStartDay, props.trendSegments, props.trendProjectBySegmentId]);

  const totalCaption = isDayMode ? windowLabel : atLatestWindow ? `Last ${windowDays} days` : windowLabel;
  // If the open project gets deleted elsewhere, fall back to the list.
  useEffect(() => {
    if (selectedProjectId && !selectedProject) {
      setSelectedProjectId(null);
      setRangeMode("week");
      setWindowOffset(0);
    }
  }, [selectedProjectId, selectedProject]);

  // Only draw the chart once the loaded segments actually cover the selected
  // window — otherwise a window/mode switch would briefly render the previous
  // window's data at the new scale (flicker), then snap when the fetch lands.
  const trendReady = props.trendLoadedRange?.startDay === startDay && props.trendLoadedRange?.endDay === endDay;

  const returnToProjectLibrary = () => {
    setSelectedProjectId(null);
    setRangeMode("week");
    setWindowOffset(0);
  };

  const openProject = (projectId: string) => {
    setRangeMode("week");
    setWindowOffset(0);
    setSelectedProjectId(projectId);
  };

  return (
    <div className="page projects-page">
      <div className="pg-head projects-page__head">
        {selectedProject ? (
          <div className="projects-page__detail-title">
            <button type="button" className="app-btn app-btn--quiet app-btn--compact projects-page__back" onClick={returnToProjectLibrary}>
              <span aria-hidden="true">&larr;</span> Projects
            </button>
            <div className="projects-page__project-identity">
              <span className="pt-swatch" style={{ background: selectedProject.color }} aria-hidden="true" />
              <h1>{selectedProject.name}</h1>
              <span className={`chip${selectedProject.status === "archived" ? " gray" : " green"}`}>
                {selectedProject.status === "archived" ? "Archived" : "Active"}
              </span>
            </div>
          </div>
        ) : (
          <div className="projects-page__heading-copy">
            <div className="projects-page__title">
              <h1>Projects</h1>
              <span className="projects-help">
                <button type="button" className="help-trigger projects-help__trigger" aria-label="What are projects?" aria-describedby="projects-help-tip">?</button>
                <span className="projects-help__tip" id="projects-help-tip" role="tooltip">Describe the work that belongs together. Drifty uses that description to group matching activity into a project.</span>
              </span>
            </div>
            <p>Define the work Drifty should group your activity into.</p>
          </div>
        )}
        {selectedProject ? (
          <div className="classification-range-controls trends-range-controls">
            <div className="settings-mode-switch settings-mode-switch--triple" role="radiogroup" aria-label="Project detail range">
              {RANGE_MODE_OPTIONS.map((option) => (
                <button
                  type="button"
                  className={rangeMode === option.key ? "settings-mode-option is-active" : "settings-mode-option"}
                  role="radio"
                  aria-checked={rangeMode === option.key}
                  key={option.key}
                  onClick={() => {
                    setRangeMode(option.key);
                    setWindowOffset(0);
                  }}
                >
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <DateNavigator
              ariaLabel="Project detail time window"
              label={windowLabel}
              todayLabel="Latest"
              isTodayDisabled={atLatestWindow}
              isNextDisabled={atLatestWindow}
              onPrevious={() => setWindowOffset((offset) => offset + 1)}
              onToday={() => setWindowOffset(0)}
              onNext={() => setWindowOffset((offset) => Math.max(0, offset - 1))}
              previousLabel="Show previous project window"
              nextLabel="Show next project window"
            />
          </div>
        ) : null}
      </div>

      {props.runError ? (
        <div className="projects-page__banner projects-page__banner--error" role="alert">{props.runError}</div>
      ) : null}

      {selectedProject ? (
        <ProjectDetailView
          project={selectedProject}
          projects={props.projects}
          trendSegments={props.trendSegments}
          trendProjectBySegmentId={props.trendProjectBySegmentId}
          trendReady={trendReady}
          windowDays={windowDays}
          startDay={startDay}
          endDay={endDay}
          isDayMode={isDayMode}
          startOfDayMinutes={props.startOfDayMinutes}
          totalCaption={totalCaption}
          windowLabel={windowLabel}
          totalSeconds={totalSecondsByProject.get(selectedProject.id) ?? 0}
          windowProjectSeconds={[...totalSecondsByProject.values()].reduce((sum, value) => sum + value, 0)}
          lastActivityLabel={(() => {
            const day = lastActivityByProject.get(selectedProject.id);
            if (!day) return "—";
            const parsed = new Date(`${day}T00:00:00`);
            return Number.isNaN(parsed.getTime()) ? "—" : LAST_ACTIVITY_FORMAT.format(parsed);
          })()}
          busy={props.running || props.projectsLoading}
          onSave={props.onSaveProject}
        />
      ) : (
        <>
          <ProjectsManager
            projects={props.projects}
            totalSecondsByProject={libraryTotalSecondsByProject}
            lastActivityByProject={libraryLastActivityByProject}
            totalCaption="Latest 7 days"
            onSave={props.onSaveProject}
            onDelete={props.onDeleteProject}
            onOpenProject={openProject}
            busy={props.running || props.projectsLoading}
          />
          {activeProjects.length > 0 ? (
            <div className="projects-overview-layout">
              <div className="projects-charts projects-charts--overview">
                {trendReady ? (
                  <ProjectTrendChart
                    segments={props.trendSegments}
                    projectBySegmentId={props.trendProjectBySegmentId}
                    projects={props.projects}
                    days={PROJECT_LIBRARY_WINDOW_DAYS}
                    endDay={endDay}
                    variant="overview"
                    onOpenTrends={props.onOpenTrends}
                  />
                ) : (
                  <ProjectTrendChartSkeleton
                    windowLabel={`Latest ${PROJECT_LIBRARY_WINDOW_DAYS} days`}
                    legendProjects={activeProjects}
                    isDayMode={false}
                    startDay={startDay}
                    endDay={endDay}
                    startOfDayMinutes={props.startOfDayMinutes}
                    variant="overview"
                    onOpenTrends={props.onOpenTrends}
                  />
                )}
              </div>
              <ProjectMatchingCard
                activeProjectCount={activeProjects.length}
                analysisConnected={props.analysisConnected}
                analysisSetup={props.analysisSetup}
                layout="card"
                running={props.running}
                onConfigureModel={props.onConfigureModel}
                onRunAnalysis={props.onRunAnalysis}
              />
            </div>
          ) : null}
        </>
      )}

      {!selectedProject && activeProjects.length === 0 ? (
        <div className="projects-page__footer">
          <ProjectMatchingCard
            activeProjectCount={activeProjects.length}
            analysisConnected={props.analysisConnected}
            analysisSetup={props.analysisSetup}
            layout="strip"
            running={props.running}
            onConfigureModel={props.onConfigureModel}
            onRunAnalysis={props.onRunAnalysis}
          />
        </div>
      ) : null}

      <ProjectPassConsentModal
        open={props.consentOpen}
        providerLabel={props.consentProviderLabel}
        includesSiteUrl={props.consentIncludesSiteUrl}
        includesWindowTitles={props.consentIncludesWindowTitles}
        includesContentContext={props.consentIncludesContentContext}
        storesCloudSamples={props.consentStoresCloudSamples}
        onConfirm={props.onConsentConfirm}
        onCancel={props.onConsentCancel}
      />
    </div>
  );
}
