import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivitySegment, Project, ProjectAssignmentRecord } from "@drifty/domain";
import { shiftIsoDate } from "@drifty/domain";
import "./projects.css";
import { localeForDisplayLanguage, buildIsoDayList, describeLocalizedRelativeDay, formatLocalizedCompactDurationFromSeconds, isoDateFromTimestamp, logicalTodayIsoDate } from "../../lib/formatting";
import { AnchoredPresence } from "../../components/AnchoredPresence";
import type { IntelligenceProviderChoice } from "../categories/CategoryEditorAiNotice";
import { ProjectsReconnect, ProjectsStrip } from "./ProjectsLock";
import { ProjectsSharePanel, type ShareProject } from "./ProjectsSharePanel";
import { ProjectTrendChart } from "./ProjectTrendChart";
import { ProjectTrendChartSkeleton } from "./ProjectTrendChartSkeleton";
import type { ProjectsLockReason } from "./projectsLockTypes";
import { PROJECT_LIBRARY_WINDOW_DAYS, formatProjectLastActivity } from "./projectDates";
import { DateNavigator } from "../../components/DateNavigator";
import { ProjectDetailView } from "./ProjectDetailView";
import { ProjectsManager } from "./ProjectsManager";
import { analysisModelDisplayLabel, type AnalysisAiSetupState } from "../settings/analysisModelSetup";
import { aggregateProjectAutoAnalysisPhase, type ProjectAutoAnalysisState } from "./projectAutoAnalysisState";
import { formatProjectMatchCooldown, type ProjectMatchCooldown } from "./projectMatchCooldown";
import { useLocalization } from "../localization/LocalizationContext";
import { PROJECT_PASS_NO_RESULTS_MESSAGE, PROJECT_PASS_NOTHING_TO_ANALYZE_MESSAGE, PROJECT_PASS_NOTHING_TO_ANALYZE_PREFIX } from "../classification/useProjectClassification";
import { classifyBackgroundError, describeBackgroundError, type DescribedActionError } from "../../lib/actionErrors";

// Known project-pass messages are localized. A tracker or connection failure
// reads in the app language with its original wording on hover; a provider's
// own message (a bad key, an unknown model) is the actionable part, so it
// stays as written.
function describeProjectRunError(message: string, t: ReturnType<typeof useLocalization>["t"]): DescribedActionError {
  if (message === PROJECT_PASS_NO_RESULTS_MESSAGE) return { message: t("projects.runError.noResults"), detail: null };
  if (message === PROJECT_PASS_NOTHING_TO_ANALYZE_MESSAGE || message.startsWith(PROJECT_PASS_NOTHING_TO_ANALYZE_PREFIX)) {
    return { message: t("projects.runError.nothingToAnalyze"), detail: null };
  }
  if (classifyBackgroundError(message)) return describeBackgroundError(message, t);
  return { message, detail: null };
}

type TrendRangeMode = "day" | "week" | "month";

const RANGE_MODE_OPTIONS = ["day", "week", "month"] as const satisfies readonly TrendRangeMode[];

// Day is a single day rendered as an intraday (30-minute window) chart;
// Week/Month are rolling day-bucketed windows.
function windowDaysFor(mode: TrendRangeMode): number {
  if (mode === "day") return 1;
  if (mode === "month") return 30;
  return 7;
}

function shortDate(iso: string, language: "en" | "ko" | "es"): string {
  const parsed = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), { month: "short", day: "numeric" }).format(parsed);
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
  /** Opens the category editor on a project, or on a new one for null. */
  readonly onEditProject: (project: Project | null) => void;
  readonly onRunAnalysis: () => void;
  /** No Intelligence at all (on-device Free or unset), the same test as the category editor's lock. */
  readonly intelligenceLocked?: boolean;
  /** Drifty Cloud picked from the line over a stopped list (see plans, sign in). */
  readonly onPickIntelligence?: (provider: IntelligenceProviderChoice) => void | Promise<void>;
  /** Why projects stopped gathering time, said in one line over the list. */
  readonly lockReason?: ProjectsLockReason;
  /** The first logical day nothing was gathered (the trial's or plan's end); later time goes to no project. */
  readonly stoppedSinceDay?: string;
}

interface ProjectsStatusProps {
  /** No Intelligence at all (on-device Free or unset), the same test as the category editor's lock. */
  readonly locked: boolean;
  readonly activeProjectCount: number;
  readonly analysisConnected: boolean;
  readonly analysisSetup: AnalysisAiSetupState;
  readonly autoAnalysis: ProjectAutoAnalysisState;
  readonly matchCooldown: ProjectMatchCooldown;
  readonly running: boolean;
  readonly onConfigureModel: () => void;
  readonly onRunAnalysis: () => void;
}

/**
 * Where project matching stands, beside the title, only when there is
 * something to say: matching, paused, not connected, or no Intelligence. When
 * all is well only its menu shows (refresh the latest 7 days, Intelligence
 * settings); a paused run, a queued burst or a missing connection puts the one
 * action that helps in the line itself.
 */
function ProjectsStatus(props: ProjectsStatusProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const autoPhase = aggregateProjectAutoAnalysisPhase(props.autoAnalysis);
  // A queued burst is still pending work, so "Match now" stays clickable even
  // though the previous pass finished moments ago.
  const cooldownActive = props.matchCooldown.active && autoPhase !== "queued" && autoPhase !== "error";
  const busy = props.running || autoPhase === "running";
  const state = props.locked
    ? { tone: "ok", label: "" }
    : busy
      ? { tone: "busy", label: t("projects.status.matching") }
      : autoPhase === "queued"
        ? { tone: "busy", label: t("projects.status.queued") }
        : autoPhase === "error"
          ? { tone: "error", label: t("projects.status.paused") }
          : !props.analysisConnected
            ? { tone: "attention", label: t("projects.status.setup") }
            : { tone: "ok", label: "" };
  const actionLabel = props.running
    ? autoPhase === "running" ? t("projects.matching.matchingProgress") : t("projects.matching.refreshing")
    : autoPhase === "queued"
      ? t("projects.matching.matchNow")
      : autoPhase === "error"
        ? t("projects.matching.retryLatest")
        : cooldownActive
          ? t("projects.matching.justMatched", { remaining: props.matchCooldown.remainingSeconds < 60
            ? effectiveLanguage === "ko" ? `${props.matchCooldown.remainingSeconds}초` : effectiveLanguage === "es" ? `${props.matchCooldown.remainingSeconds} s` : formatProjectMatchCooldown(props.matchCooldown.remainingSeconds)
            : formatProjectMatchCooldown(props.matchCooldown.remainingSeconds) })
          : t("projects.matching.refreshLatest");
  const actionDisabled = props.locked || (props.running && autoPhase !== "queued") || cooldownActive || !props.analysisConnected || props.activeProjectCount === 0;
  const actionHint = cooldownActive
    ? t("projects.matching.cooldownHint")
    : props.activeProjectCount === 0 ? t("projects.matching.createFirst") : undefined;
  const inline = props.running || props.locked
    ? null
    : !props.analysisConnected && autoPhase !== "error" && autoPhase !== "queued"
      ? { label: t("projects.status.openSettings"), onClick: props.onConfigureModel }
      : autoPhase === "error" || autoPhase === "queued"
        ? { label: actionLabel, onClick: props.onRunAnalysis }
        : null;

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".projects-status__more")) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const choose = (run: () => void) => {
    trigger.current?.focus({ preventScroll: true });
    setMenuOpen(false);
    run();
  };

  return (
    <div className={`projects-status projects-status--${state.tone}`} role="group" aria-label={t("projects.matching.modelAria")}>
      {state.tone === "ok" ? null : (
        <>
          {state.tone === "busy"
            ? <span className="projects-table__analysis-spinner" aria-hidden="true" />
            : <span className="projects-status__dot" aria-hidden="true" />}
          <span role={state.tone === "busy" ? "status" : undefined}>{state.label}</span>
          {inline ? <button type="button" className="projects-status__act" onClick={inline.onClick}>{inline.label}</button> : null}
        </>
      )}
      <span className="projects-status__more">
        <button
          ref={trigger}
          type="button"
          className="pt-more"
          aria-label={t("projects.status.moreAria")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.4" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.6" cy="12" r="1.7" /></svg>
        </button>
        <AnchoredPresence>{menuOpen ? (
          <div className="pt-menu" role="menu" aria-label={t("projects.status.moreAria")}>
            {props.locked ? null : (
              <button type="button" role="menuitem" disabled={actionDisabled} title={actionHint} onClick={() => choose(props.onRunAnalysis)}>
                {actionLabel}
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => choose(props.onConfigureModel)}>
              {t("projects.status.settings")}
              {props.locked ? null : <span className="pt-menu__hint">{analysisModelLabel(props.analysisSetup)}</span>}
            </button>
          </div>
        ) : null}</AnchoredPresence>
      </span>
    </div>
  );
}

export function ProjectsPage(props: ProjectsPageProps) {
  const { effectiveLanguage, t } = useLocalization();
  const runNotice = props.runError ? describeProjectRunError(props.runError, t) : null;
  const [rangeMode, setRangeMode] = useState<TrendRangeMode>("week");
  const [windowOffset, setWindowOffset] = useState(0);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

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
    ? relativeDayLabel === (effectiveLanguage === "ko" ? "선택한 날짜" : effectiveLanguage === "es" ? "Día seleccionado" : "Selected day") ? shortDate(endDay, effectiveLanguage) : relativeDayLabel
    : `${shortDate(startDay, effectiveLanguage)} – ${shortDate(endDay, effectiveLanguage)}`;

  // Tell the shell which window to load trend segments/assignments for. A
  // project's detail also loads the window before, to compare against it.
  const loadStartDay = selectedProject ? shiftIsoDate(startDay, -dataWindowDays) : startDay;
  const { onTrendWindowChange } = props;
  useEffect(() => {
    onTrendWindowChange({ startDay: loadStartDay, endDay });
  }, [onTrendWindowChange, loadStartDay, endDay]);

  // Segments inside the shown window.
  const windowSegments = useMemo(() => props.trendSegments.filter((segment) => {
    const day = isoDateFromTimestamp(segment.startedAt);
    return Boolean(day) && day! >= startDay && day! <= endDay;
  }), [props.trendSegments, startDay, endDay]);

  // Per-project totals + latest active day within the shown window.
  const { totalSecondsByProject, lastActivityByProject } = useMemo(() => {
    const totals = new Map<string, number>();
    const lastDays = new Map<string, string>();
    for (const segment of windowSegments) {
      const projectId = props.trendProjectBySegmentId.get(segment.id);
      if (!projectId) continue;
      totals.set(projectId, (totals.get(projectId) ?? 0) + segment.durationSeconds);
      const day = isoDateFromTimestamp(segment.startedAt);
      if (day && day > (lastDays.get(projectId) ?? "")) lastDays.set(projectId, day);
    }
    return { totalSecondsByProject: totals, lastActivityByProject: lastDays };
  }, [windowSegments, props.trendProjectBySegmentId]);

  // The open project's time in the window before, for "+3h vs. the previous 7 days".
  const previousProjectSeconds = useMemo(() => {
    if (!selectedProject) return 0;
    let total = 0;
    for (const segment of props.trendSegments) {
      const day = isoDateFromTimestamp(segment.startedAt);
      if (!day || day < loadStartDay || day >= startDay) continue;
      if (props.trendProjectBySegmentId.get(segment.id) === selectedProject.id) total += segment.durationSeconds;
    }
    return total;
  }, [selectedProject, props.trendSegments, props.trendProjectBySegmentId, loadStartDay, startDay]);

  // Project rows, overview chart, and assignment refresh share one seven-day window.
  const librarySummaryStartDay = shiftIsoDate(endDay, -(PROJECT_LIBRARY_WINDOW_DAYS - 1));
  const library = useMemo(() => {
    const days = buildIsoDayList(librarySummaryStartDay, endDay);
    const dayIndex = new Map(days.map((day, index) => [day, index]));
    const totals = new Map<string, number>();
    const lastDays = new Map<string, string>();
    const daily = new Map<string, number[]>();
    // Once Intelligence stopped, nothing after that day belongs to a project.
    const stopDay = props.intelligenceLocked === true ? props.stoppedSinceDay : undefined;
    for (const segment of props.trendSegments) {
      const day = isoDateFromTimestamp(segment.startedAt);
      if (!day) continue;
      const index = dayIndex.get(day);
      if (index === undefined) continue;
      const projectId = stopDay && day >= stopDay ? undefined : props.trendProjectBySegmentId.get(segment.id);
      if (!projectId) continue;
      totals.set(projectId, (totals.get(projectId) ?? 0) + segment.durationSeconds);
      if (day > (lastDays.get(projectId) ?? "")) lastDays.set(projectId, day);
      const perDay = daily.get(projectId) ?? days.map(() => 0);
      perDay[index]! += segment.durationSeconds;
      daily.set(projectId, perDay);
    }
    for (const project of props.projects) {
      if (!daily.has(project.id)) daily.set(project.id, days.map(() => 0));
    }
    return { totals, lastDays, daily };
  }, [endDay, librarySummaryStartDay, props.projects, props.trendSegments, props.trendProjectBySegmentId, props.intelligenceLocked, props.stoppedSinceDay]);
  const today = logicalTodayIsoDate(props.startOfDayMinutes);
  const chartAssignments = useMemo(() => {
    const stopDay = props.intelligenceLocked === true ? props.stoppedSinceDay : undefined;
    if (!stopDay) return props.trendProjectBySegmentId;
    const kept = new Map<string, string>();
    for (const segment of props.trendSegments) {
      const projectId = props.trendProjectBySegmentId.get(segment.id);
      const day = isoDateFromTimestamp(segment.startedAt);
      if (projectId && day && day < stopDay) kept.set(segment.id, projectId);
    }
    return kept;
  }, [props.intelligenceLocked, props.stoppedSinceDay, props.trendSegments, props.trendProjectBySegmentId]);
  const locked = props.intelligenceLocked === true;
  const lockedEmpty = locked && props.projects.length === 0;
  // The split beside the week's chart: active projects with time, biggest first.
  const shareProjects: ShareProject[] = activeProjects
    .map((project) => ({ id: project.id, name: project.name, color: project.color || "#6366f1", total: library.totals.get(project.id) ?? 0 }))
    .filter((item) => item.total > 0)
    .sort((left, right) => right.total - left.total);
  const newProjectButton = (
    <button type="button" className="app-btn app-btn--primary" disabled={props.running || props.projectsLoading} aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); props.onEditProject(null); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      {t("projects.new")}
    </button>
  );

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
  const trendReady = props.trendLoadedRange?.startDay === loadStartDay && props.trendLoadedRange?.endDay === endDay;
  const comparison = (() => {
    if (!selectedProject || !trendReady) return null;
    const delta = (totalSecondsByProject.get(selectedProject.id) ?? 0) - previousProjectSeconds;
    if (Math.abs(delta) < 60) return t("projects.detail.vsSame");
    const signed = (delta > 0 ? "+" : "−") + formatLocalizedCompactDurationFromSeconds(Math.abs(delta), effectiveLanguage);
    return t(isDayMode ? "projects.detail.vsDay" : rangeMode === "month" ? "projects.detail.vsMonth" : "projects.detail.vsWeek", { delta: signed });
  })();

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
              {selectedProject.status === "archived" ? <span className="chip gray">{t("common.archived")}</span> : null}
            </div>
          </div>
        ) : (
          <div className="projects-page__heading-copy">
            <div className="projects-page__title">
              <h1>{t("projects.title")}</h1>
            </div>
          </div>
        )}
        {!selectedProject && !lockedEmpty ? (
          <div className="projects-page__head-actions">
            <ProjectsStatus
              locked={locked}
              activeProjectCount={matchableProjectCount}
              analysisConnected={props.analysisConnected}
              analysisSetup={props.analysisSetup}
              autoAnalysis={props.autoAnalysis}
              matchCooldown={props.matchCooldown}
              running={props.running}
              onConfigureModel={props.onConfigureModel}
              onRunAnalysis={props.onRunAnalysis}
            />
            {props.projects.length > 0 && !locked ? newProjectButton : null}
          </div>
        ) : null}
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

      {runNotice ? (
        <div className="projects-page__banner projects-page__banner--error" role="alert" title={runNotice.detail ?? undefined}>
          {runNotice.message}{runNotice.detail ? <span className="sr-only"> {runNotice.detail}</span> : null}
        </div>
      ) : null}

      {selectedProject ? (
        <ProjectDetailView
          project={selectedProject}
          trendSegments={windowSegments}
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
          comparison={comparison}
          windowProjectSeconds={[...totalSecondsByProject.values()].reduce((sum, value) => sum + value, 0)}
          lastActivityLabel={formatProjectLastActivity(lastActivityByProject.get(selectedProject.id), today, effectiveLanguage, t)}
          busy={props.running || props.projectsLoading}
          onEdit={() => props.onEditProject(selectedProject)}
        />
      ) : props.projects.length === 0 ? (
        <>
          {/* Without Intelligence: the same slim line as a stopped list, over the ordinary empty page; New project opens the editor's lock. */}
          {lockedEmpty ? (
            <ProjectsStrip text={t("projects.lock.stripLine")} primary={{ label: t("projects.lock.stripAction"), run: props.onConfigureModel }} />
          ) : null}
          <section className="projects-empty" aria-labelledby="projects-empty-title">
            <h2 id="projects-empty-title">{t("projects.empty.title")}</h2>
            <p>{t("projects.empty.body")}</p>
            {newProjectButton}
          </section>
        </>
      ) : (
        <>
          {locked ? (
            <ProjectsReconnect
              reason={props.lockReason ?? "disconnected"}
              onPickCloud={() => void props.onPickIntelligence?.("cloud")}
              onOpenSettings={props.onConfigureModel}
            />
          ) : null}
          <ProjectsManager
            projects={props.projects}
            totalSecondsByProject={library.totals}
            lastActivityByProject={library.lastDays}
            totalCaption={t("projects.latestDays", { count: PROJECT_LIBRARY_WINDOW_DAYS })}
            dailySecondsByProject={library.daily}
            today={today}
            autoAnalysis={props.autoAnalysis}
            onEditProject={locked ? undefined : props.onEditProject}
            onOpenProject={openProject}
            busy={props.running || props.projectsLoading}
          />
          {activeProjects.length > 0 ? (
            <div className="projects-overview-layout">
              <div className="projects-charts projects-charts--overview">
                {trendReady ? (
                  <ProjectTrendChart
                    segments={props.trendSegments}
                    projectBySegmentId={chartAssignments}
                    projects={props.projects}
                    days={PROJECT_LIBRARY_WINDOW_DAYS}
                    endDay={endDay}
                    variant="overview"
                    onOpenTrends={props.onOpenTrends}
                    legend={false}
                  />
                ) : (
                  <ProjectTrendChartSkeleton
                    windowLabel={t("projects.latestDays", { count: PROJECT_LIBRARY_WINDOW_DAYS })}
                    legendProjects={[]}
                    isDayMode={false}
                    startDay={startDay}
                    endDay={endDay}
                    startOfDayMinutes={props.startOfDayMinutes}
                    variant="overview"
                    onOpenTrends={props.onOpenTrends}
                  />
                )}
              </div>
              <ProjectsSharePanel projects={shareProjects} days={PROJECT_LIBRARY_WINDOW_DAYS} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
