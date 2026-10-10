import { useEffect, useMemo, useState } from "react";
import type { ActivitySegment, Project, ProjectAssignmentRecord, ProjectInput } from "@drifty/domain";
import { shiftIsoDate } from "@drifty/domain";
import "./projects.css";
import { describeLocalizedRelativeDay, isoDateFromTimestamp } from "../../lib/formatting";
import { DateNavigator } from "../../components/DateNavigator";
import { ProjectDetailView } from "./ProjectDetailView";
import { ProjectTrendChart } from "./ProjectTrendChart";
import { ProjectTrendChartSkeleton } from "./ProjectTrendChartSkeleton";
import { ProjectsManager } from "./ProjectsManager";
import type { ProjectSaveResult } from "./ProjectEditorModal";
import type { ProjectDeleteResult } from "./ProjectDeleteConfirmation";
import { analysisModelDisplayLabel, type AnalysisAiSetupState } from "../settings/analysisModelSetup";
import { aggregateProjectAutoAnalysisPhase, type ProjectAutoAnalysisState } from "./projectAutoAnalysisState";
import { formatProjectMatchCooldown, NO_PROJECT_MATCH_COOLDOWN, type ProjectMatchCooldown } from "./projectMatchCooldown";
import { useLocalization } from "../localization/LocalizationContext";
import { PROJECT_PASS_NO_RESULTS_MESSAGE, PROJECT_PASS_NOTHING_TO_ANALYZE_MESSAGE } from "../classification/useProjectClassification";

// Known project-pass messages are localized; provider and transport errors stay verbatim.
function localizeProjectRunError(message: string, t: ReturnType<typeof useLocalization>["t"]): string {
  if (message === PROJECT_PASS_NO_RESULTS_MESSAGE) return t("projects.runError.noResults");
  if (message === PROJECT_PASS_NOTHING_TO_ANALYZE_MESSAGE) return t("projects.runError.nothingToAnalyze");
  return message;
}

const PROJECT_LIBRARY_WINDOW_DAYS = 7;

type TrendRangeMode = "day" | "week" | "month";

const RANGE_MODE_OPTIONS = ["day", "week", "month"] as const satisfies readonly TrendRangeMode[];

// Day is a single day rendered as an intraday (30-minute window) chart;
// Week/Month are rolling day-bucketed windows.
function windowDaysFor(mode: TrendRangeMode): number {
  if (mode === "day") return 1;
  if (mode === "month") return 30;
  return 7;
}

function shortDate(iso: string, language: "en" | "ko"): string {
  const parsed = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" }).format(parsed);
}

function analysisModelLabel(setup: AnalysisAiSetupState): string {
  if (setup.provider === "cloud") return "Drifty Cloud";
  if (setup.provider === "openrouter") return `OpenRouter · ${analysisModelDisplayLabel(setup.openRouterModel)}`;
  if (setup.provider === "openai") return `OpenAI · ${analysisModelDisplayLabel(setup.openaiModel)}`;
  if (setup.provider === "anthropic") return `Anthropic · ${analysisModelDisplayLabel(setup.anthropicModel)}`;
  return "Custom endpoint";
}

export interface ProjectsPageProps {
  readonly createRequested?: boolean;
  readonly onCreateRequestHandled?: () => void;
  readonly projects: readonly Project[];
  /** Active team projects the pass also matches against; they enable a refresh on their own. */
  readonly activeTeamProjectCount?: number;
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
  readonly autoAnalysis: ProjectAutoAnalysisState;
  /** Suppresses a redundant manual re-run right after a completed pass. */
  readonly matchCooldown: ProjectMatchCooldown;
  readonly onTrendWindowChange: (range: { readonly startDay: string; readonly endDay: string }) => void;
  readonly onConfigureModel: () => void;
  readonly onOpenTrends: () => void;
  readonly onSaveProject: (input: ProjectInput) => Promise<ProjectSaveResult> | ProjectSaveResult;
  readonly onDeleteProject: (id: string) => Promise<ProjectDeleteResult> | ProjectDeleteResult | void;
  readonly onRunAnalysis: () => void;
}

interface ProjectMatchingCardProps {
  readonly activeProjectCount: number;
  readonly analysisConnected: boolean;
  readonly analysisSetup: AnalysisAiSetupState;
  readonly autoAnalysis: ProjectAutoAnalysisState;
  readonly matchCooldown: ProjectMatchCooldown;
  readonly layout: "strip" | "card";
  readonly running: boolean;
  readonly onConfigureModel: () => void;
  readonly onRunAnalysis: () => void;
}

function ProjectMatchingCard(props: ProjectMatchingCardProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const modelLabel = analysisModelLabel(props.analysisSetup);
  const autoPhase = aggregateProjectAutoAnalysisPhase(props.autoAnalysis);
  // A queued burst is still pending work, so "Match now" stays clickable even
  // though the previous pass finished moments ago.
  const cooldownActive = props.matchCooldown.active && autoPhase !== "queued" && autoPhase !== "error";
  const readiness = autoPhase === "running"
    ? t("projects.matching.matching")
    : autoPhase === "queued"
      ? t("projects.matching.soon")
      : autoPhase === "error"
        ? t("projects.matching.retryNeeded")
        : !props.analysisConnected
          ? t("projects.matching.setupRequired")
          : cooldownActive ? t("projects.matching.upToDate") : t("projects.matching.ready");
  const actionLabel = autoPhase === "running"
    ? t("projects.matching.matchingProgress")
    : autoPhase === "queued"
      ? t("projects.matching.matchNow")
      : autoPhase === "error"
        ? t("projects.matching.retryLatest")
        : cooldownActive
          ? t("projects.matching.justMatched", { remaining: effectiveLanguage === "ko" && props.matchCooldown.remainingSeconds < 60 ? `${props.matchCooldown.remainingSeconds}초` : formatProjectMatchCooldown(props.matchCooldown.remainingSeconds) })
          : t("projects.matching.refreshLatest");
  return (
    <div
      className={`projects-model-status projects-model-status--${props.layout}${props.analysisConnected ? " is-connected" : " is-disconnected"}`}
      role="group"
      aria-label={t("projects.matching.modelAria")}
    >
      <div className="projects-model-status__info">
        <span className="projects-model-status__label">{t("projects.matching.label")}</span>
        <span className="projects-model-status__value">
          {props.layout === "strip"
            ? t("projects.matching.usesModel", { model: modelLabel })
            : autoPhase === "running"
              ? t("projects.matching.newProject")
              : autoPhase === "queued"
                ? t("projects.matching.queuedProjects")
                : t("projects.matching.refreshAssignments")}
        </span>
        {props.layout !== "strip" ? (
          <dl className="projects-model-status__meta">
            <div><dt>{t("projects.matching.model")}</dt><dd>{modelLabel}</dd></div>
            <div><dt>{t("projects.matching.refreshScope")}</dt><dd>{t("projects.matching.latestSeven")}</dd></div>
          </dl>
        ) : null}
      </div>
      <span className={`projects-model-status__readiness${props.analysisConnected ? " is-connected" : ""}`}>
        <span className="projects-model-status__readiness-dot" aria-hidden="true" />
        {props.layout === "card"
          ? readiness
          : autoPhase === "running" || autoPhase === "queued"
            ? t("projects.matching.recentActivity")
            : props.analysisConnected
              ? t("projects.matching.modelReady")
              : t("projects.matching.modelSetupRequired")}
      </span>
      <div className="projects-model-status__actions">
        <button type="button" className="app-btn app-btn--secondary" onClick={props.onConfigureModel}>{t("projects.matching.modelSettings")}</button>
        <button
          type="button"
          className="app-btn app-btn--secondary"
          onClick={props.onRunAnalysis}
          disabled={(props.running && autoPhase !== "queued") || cooldownActive || !props.analysisConnected || props.activeProjectCount === 0}
          title={cooldownActive ? t("projects.matching.cooldownHint") : undefined}
        >
          {props.running ? (autoPhase === "running" ? t("projects.matching.matchingProgress") : t("projects.matching.refreshing")) : actionLabel}
        </button>
      </div>
      {props.activeProjectCount === 0 ? (
        <p className="projects-model-status__reason">{t("projects.matching.createFirst")}</p>
      ) : autoPhase === "waiting_for_model" || !props.analysisConnected ? (
        <p className="projects-model-status__reason">{t("projects.matching.connectFirst")}</p>
      ) : autoPhase === "error" ? (
        <p className="projects-model-status__reason">{t("projects.matching.paused")}</p>
      ) : cooldownActive ? (
        <p className="projects-model-status__reason">{t("projects.matching.upToDateDetail")}</p>
      ) : null}
    </div>
  );
}

export function ProjectsPage(props: ProjectsPageProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [rangeMode, setRangeMode] = useState<TrendRangeMode>("week");
  const [windowOffset, setWindowOffset] = useState(0);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (props.createRequested) setSelectedProjectId(null);
  }, [props.createRequested]);

  const activeProjects = props.projects.filter((project) => project.status === "active");
  const matchableProjectCount = activeProjects.length + (props.activeTeamProjectCount ?? 0);
  const selectedProject = selectedProjectId
    ? props.projects.find((project) => project.id === selectedProjectId) ?? null
    : null;

  const windowDays = windowDaysFor(rangeMode);
  const dataWindowDays = selectedProject ? windowDays : PROJECT_LIBRARY_WINDOW_DAYS;
  const isDayMode = rangeMode === "day";
  const endDay = shiftIsoDate(props.selectedDay, -windowOffset * dataWindowDays);
  const startDay = shiftIsoDate(endDay, -(dataWindowDays - 1));
  const atLatestWindow = windowOffset === 0;
  const relativeDayLabel = describeLocalizedRelativeDay(endDay, effectiveLanguage, props.startOfDayMinutes);
  const windowLabel = isDayMode
    ? relativeDayLabel === (effectiveLanguage === "ko" ? "선택한 날짜" : "Selected day") ? shortDate(endDay, effectiveLanguage) : relativeDayLabel
    : `${shortDate(startDay, effectiveLanguage)} – ${shortDate(endDay, effectiveLanguage)}`;

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

  const totalCaption = isDayMode ? windowLabel : atLatestWindow ? t("projects.lastDays", { count: windowDays }) : windowLabel;
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
              <span aria-hidden="true">&larr;</span> {t("projects.back")}
            </button>
            <div className="projects-page__project-identity">
              <span className="pt-swatch" style={{ background: selectedProject.color }} aria-hidden="true" />
              <h1>{selectedProject.name}</h1>
              <span className={`chip${selectedProject.status === "archived" ? " gray" : " green"}`}>
                {t(selectedProject.status === "archived" ? "common.archived" : "common.active")}
              </span>
            </div>
          </div>
        ) : (
          <div className="projects-page__heading-copy">
            <div className="projects-page__title">
              <h1>{t("projects.title")}</h1>
              <span className="projects-help">
                <button type="button" className="help-trigger projects-help__trigger" aria-label={t("projects.helpAria")} aria-describedby="projects-help-tip">?</button>
                <span className="projects-help__tip" id="projects-help-tip" role="tooltip">{t("projects.help")}</span>
              </span>
            </div>
            <p>{t("projects.description")}</p>
          </div>
        )}
        {selectedProject ? (
          <div className="classification-range-controls trends-range-controls">
            <div className="settings-mode-switch settings-mode-switch--triple" role="radiogroup" aria-label={t("projects.detailRangeAria")}>
              {RANGE_MODE_OPTIONS.map((option) => (
                <button
                  type="button"
                  className={rangeMode === option ? "settings-mode-option is-active" : "settings-mode-option"}
                  role="radio"
                  aria-checked={rangeMode === option}
                  key={option}
                  onClick={() => {
                    setRangeMode(option);
                    setWindowOffset(0);
                  }}
                >
                  <span>{t(option === "day" ? "common.day" : option === "week" ? "common.week" : "common.month")}</span>
                </button>
              ))}
            </div>
            <DateNavigator
              ariaLabel={t("projects.detailWindowAria")}
              label={windowLabel}
              todayLabel={t("common.latest")}
              isTodayDisabled={atLatestWindow}
              isNextDisabled={atLatestWindow}
              onPrevious={() => setWindowOffset((offset) => offset + 1)}
              onToday={() => setWindowOffset(0)}
              onNext={() => setWindowOffset((offset) => Math.max(0, offset - 1))}
              previousLabel={t("projects.previousWindow")}
              nextLabel={t("projects.nextWindow")}
            />
          </div>
        ) : null}
      </div>

      {props.runError ? (
        <div className="projects-page__banner projects-page__banner--error" role="alert">{localizeProjectRunError(props.runError, t)}</div>
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
            return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat(effectiveLanguage === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
          })()}
          busy={props.running || props.projectsLoading}
          onSave={props.onSaveProject}
        />
      ) : (
        <>
          <ProjectsManager
            createRequested={props.createRequested}
            onCreateRequestHandled={props.onCreateRequestHandled}
            projects={props.projects}
            totalSecondsByProject={libraryTotalSecondsByProject}
            lastActivityByProject={libraryLastActivityByProject}
            totalCaption={t("projects.latestDays", { count: 7 })}
            autoAnalysis={props.autoAnalysis}
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
                    windowLabel={t("projects.latestDays", { count: PROJECT_LIBRARY_WINDOW_DAYS })}
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
                activeProjectCount={matchableProjectCount}
                analysisConnected={props.analysisConnected}
                analysisSetup={props.analysisSetup}
                autoAnalysis={props.autoAnalysis}
                matchCooldown={props.matchCooldown}
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
            activeProjectCount={matchableProjectCount}
            analysisConnected={props.analysisConnected}
            analysisSetup={props.analysisSetup}
            autoAnalysis={props.autoAnalysis}
            matchCooldown={props.matchCooldown}
            layout="strip"
            running={props.running}
            onConfigureModel={props.onConfigureModel}
            onRunAnalysis={props.onRunAnalysis}
          />
        </div>
      ) : null}

    </div>
  );
}
