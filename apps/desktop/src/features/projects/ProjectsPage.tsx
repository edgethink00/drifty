import { useEffect, useMemo, useState } from "react";
import type { ActivitySegment, Project, ProjectAssignmentRecord, ProjectInput } from "@drifty/domain";
import { shiftIsoDate } from "@drifty/domain";
import "./projects.css";
import { describeRelativeDay, isoDateFromTimestamp } from "../../lib/formatting";
import { ProjectDetailView } from "./ProjectDetailView";
import { ProjectTrendChart } from "./ProjectTrendChart";
import { ProjectTrendChartSkeleton } from "./ProjectTrendChartSkeleton";
import { ProjectsManager } from "./ProjectsManager";
import { ProjectPassConsentModal } from "../classification/ProjectPassConsentModal";
import { analysisModelDisplayLabel, type AnalysisAiSetupState } from "../settings/analysisModelSetup";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const LAST_ACTIVITY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

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
  readonly onSaveProject: (input: ProjectInput) => void;
  readonly onDeleteProject: (id: string) => void;
  readonly onRunAnalysis: () => void;
  readonly onConsentConfirm: () => void;
  readonly onConsentCancel: () => void;
}

export function ProjectsPage(props: ProjectsPageProps) {
  const [rangeMode, setRangeMode] = useState<TrendRangeMode>("week");
  const [windowOffset, setWindowOffset] = useState(0);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const activeProjects = props.projects.filter((project) => project.status === "active");

  const windowDays = windowDaysFor(rangeMode);
  const isDayMode = rangeMode === "day";
  const endDay = shiftIsoDate(props.selectedDay, -windowOffset * windowDays);
  const startDay = shiftIsoDate(endDay, -(windowDays - 1));
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

  const totalCaption = isDayMode ? windowLabel : atLatestWindow ? `Last ${windowDays} days` : windowLabel;

  const selectedProject = selectedProjectId
    ? props.projects.find((project) => project.id === selectedProjectId) ?? null
    : null;
  // If the open project gets deleted elsewhere, fall back to the list.
  useEffect(() => {
    if (selectedProjectId && !selectedProject) setSelectedProjectId(null);
  }, [selectedProjectId, selectedProject]);

  // Only draw the chart once the loaded segments actually cover the selected
  // window — otherwise a window/mode switch would briefly render the previous
  // window's data at the new scale (flicker), then snap when the fetch lands.
  const trendReady = props.trendLoadedRange?.startDay === startDay && props.trendLoadedRange?.endDay === endDay;

  return (
    <div className="page projects-page">
      <div className="pg-head projects-page__head">
        <div className="projects-page__title">
          <h1>Projects</h1>
          <span className="projects-help">
            <button type="button" className="projects-help__trigger" aria-label="What are projects?">How it works</button>
            <span className="projects-help__tip" role="tooltip">Group your tracked time by what it was for. Describe a project in plain language and Drifty's analysis model attributes your activity to it.</span>
          </span>
        </div>
        <div className="classification-range-controls trends-range-controls">
          <div className="settings-mode-switch settings-mode-switch--triple" role="radiogroup" aria-label="Range granularity">
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
          <div className="day-nav" aria-label="Trend time window">
            <div className="day-nav__current"><strong>{windowLabel}</strong></div>
            <button
              className="ghost-button day-nav__step"
              type="button"
              aria-label="Previous window"
              onClick={() => setWindowOffset((offset) => offset + 1)}
            >
              &lsaquo;
            </button>
            <button
              className="ghost-button day-nav__today"
              type="button"
              disabled={atLatestWindow}
              onClick={() => setWindowOffset(0)}
            >
              Latest
            </button>
            <button
              className="ghost-button day-nav__step"
              type="button"
              aria-label="Next window"
              disabled={atLatestWindow}
              onClick={() => setWindowOffset((offset) => Math.max(0, offset - 1))}
            >
              &rsaquo;
            </button>
          </div>
        </div>
      </div>

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
          onBack={() => setSelectedProjectId(null)}
          onSave={props.onSaveProject}
        />
      ) : (
        <>
          <ProjectsManager
            projects={props.projects}
            totalSecondsByProject={totalSecondsByProject}
            lastActivityByProject={lastActivityByProject}
            totalCaption={totalCaption}
            onSave={props.onSaveProject}
            onDelete={props.onDeleteProject}
            onOpenProject={setSelectedProjectId}
            busy={props.running || props.projectsLoading}
          />

          {activeProjects.length > 0 ? (
            <div className="projects-charts">
              {!trendReady ? (
                <ProjectTrendChartSkeleton
                  windowLabel={windowLabel}
                  legendProjects={activeProjects}
                  isDayMode={isDayMode}
                  startDay={startDay}
                  endDay={endDay}
                  startOfDayMinutes={props.startOfDayMinutes}
                />
              ) : (
                <ProjectTrendChart
                  segments={props.trendSegments}
                  projectBySegmentId={props.trendProjectBySegmentId}
                  projects={props.projects}
                  days={windowDays}
                  endDay={endDay}
                  intraday={isDayMode}
                  startOfDayMinutes={props.startOfDayMinutes}
                />
              )}
            </div>
          ) : null}
        </>
      )}

      <div className="projects-page__footer">
        {props.runError ? (
          <div className="projects-page__banner projects-page__banner--error" role="alert">Analysis failed: {props.runError}</div>
        ) : null}
        <div className={`projects-model-status${props.analysisConnected ? " is-connected" : " is-disconnected"}`} role="group" aria-label="Project analysis model">
          <div className="projects-model-status__info">
            <span className="projects-model-status__label">Project analysis</span>
            <span className="projects-model-status__value">{analysisModelLabel(props.analysisSetup)}</span>
          </div>
          <span className={`projects-model-status__chip${props.analysisConnected ? " is-connected" : ""}`}>
            {props.analysisConnected ? "Connected" : "Needs setup"}
          </span>
          <div className="projects-model-status__actions">
            <button type="button" className="settings-btn" onClick={props.onConfigureModel}>AI setup</button>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={props.onRunAnalysis}
              disabled={props.running || !props.analysisConnected || activeProjects.length === 0}
            >
              {props.running ? "Analyzing…" : "Analyze last 7 days"}
            </button>
          </div>
          {activeProjects.length === 0 ? (
            <p className="projects-model-status__reason">Create at least one active project before running analysis.</p>
          ) : !props.analysisConnected ? (
            <p className="projects-model-status__reason">Connect an analysis model before running analysis.</p>
          ) : null}
        </div>
      </div>

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
