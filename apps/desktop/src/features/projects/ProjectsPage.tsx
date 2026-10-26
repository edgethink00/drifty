import { analysisConnectionLabel } from "../settings/sharedAiConnection";
import type { DisplayLanguage } from "../localization/languageCatalog";
import { isAdditionalDisplayLanguage, supplementalText } from "../localization/supplementalCopy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivitySegment, Project, ProjectAssignmentRecord, ProjectInput } from "@drifty/domain";
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
import { ProjectsManager, ProjectsManagerLoading } from "./ProjectsManager";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { NewProjectDialog } from "./NewProjectDialog";
import { ModalPresence } from "../../components/ModalPresence";
import type { ProjectSaveResult } from "./projectSaveResult";
import { DEFAULT_PROJECT_LIBRARY_VIEW, projectLibraryOrder, projectLibraryPageOf, type ProjectLibraryView } from "./projectLibraryView";
import type { ProjectHistoryStep } from "../../app/navigation";
import { analysisModelDisplayLabel, type AnalysisAiSetupState } from "../settings/analysisModelSetup";
import { aggregateProjectAutoAnalysisPhase, type ProjectAutoAnalysisState } from "./projectAutoAnalysisState";
import { formatProjectMatchCooldown, type ProjectMatchCooldown } from "./projectMatchCooldown";
import { useLocalization } from "../localization/LocalizationContext";
import { PROJECT_PASS_NO_RESULTS_MESSAGE, PROJECT_PASS_NOTHING_TO_ANALYZE_MESSAGE, PROJECT_PASS_NOTHING_TO_ANALYZE_PREFIX } from "../classification/useProjectClassification";
import { classifyBackgroundError, describeBackgroundError, type DescribedActionError } from "../../lib/actionErrors";

/** How long a just-made project's row stays marked; the row's highlight fades over the same time. */
const JUST_MADE_MARK_MS = 2400;

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

function shortDate(iso: string, language: DisplayLanguage): string {
  const parsed = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), { month: "short", day: "numeric" }).format(parsed);
}

function analysisModelLabel(setup: AnalysisAiSetupState): string {
  if (setup.provider === "cloud") return "Drifty Cloud";
  if (setup.provider === "managed_local") return analysisConnectionLabel(setup);
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
  /** The project whose detail shows, held in the window history so its back and forward walk table and detail. */
  readonly selectedProjectId?: string | null;
  readonly onSelectProject?: (projectId: string | null, step: ProjectHistoryStep) => void;
  /** Saves a project made in the page's New project dialog; without it, New project opens the category editor. */
  readonly onSaveProject?: (input: ProjectInput) => Promise<ProjectSaveResult>;
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
  const [ownSelectedProjectId, setOwnSelectedProjectId] = useState<string | null>(null);
  const { onSelectProject } = props;
  const selectedProjectId = onSelectProject ? props.selectedProjectId ?? null : ownSelectedProjectId;
  const selectProject = useCallback((projectId: string | null, step: ProjectHistoryStep) => {
    if (onSelectProject) onSelectProject(projectId, step);
    else setOwnSelectedProjectId(projectId);
  }, [onSelectProject]);
  // The table's search, sort and page live here so a visit to a project returns to them.
  const [libraryView, setLibraryView] = useState<ProjectLibraryView>(DEFAULT_PROJECT_LIBRARY_VIEW);
  // New project opens its own small dialog. Without Intelligence it opens the
  // category editor, whose lock explains how to connect one.
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [justMadeId, setJustMadeId] = useState<string | null>(null);
  const requestNewProject = () => (props.onSaveProject && props.intelligenceLocked !== true ? setNewDialogOpen(true) : props.onEditProject(null));

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
    ? relativeDayLabel === ((isAdditionalDisplayLanguage(effectiveLanguage) ? supplementalText(effectiveLanguage, "Selected day") : effectiveLanguage === "ko" ? "선택한 날짜" : effectiveLanguage === "es" ? "Día seleccionado" : "Selected day")) ? shortDate(endDay, effectiveLanguage) : relativeDayLabel
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
  // While the library loads, the page is not known to be empty yet.
  const lockedEmpty = locked && props.projects.length === 0 && !props.projectsLoading;
  // The split beside the week's chart: active projects with time, biggest first.
  const shareProjects: ShareProject[] = activeProjects
    .map((project) => ({ id: project.id, name: project.name, color: project.color || "#6366f1", total: library.totals.get(project.id) ?? 0 }))
    .filter((item) => item.total > 0)
    .sort((left, right) => right.total - left.total);
  const newProjectButton = (
    <button type="button" className="app-btn app-btn--primary" disabled={props.running || props.projectsLoading} aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); requestNewProject(); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      {t("projects.new")}
    </button>
  );

  const totalCaption = isDayMode ? windowLabel : atLatestWindow ? t("projects.lastDays", { count: windowDays }) : windowLabel;
  // If the open project gets deleted elsewhere, fall back to the list.
  useEffect(() => {
    if (selectedProjectId && !selectedProject && !props.projectsLoading) selectProject(null, "replace");
  }, [selectedProjectId, selectedProject, props.projectsLoading, selectProject]);

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

  // Previous/next in a project's detail walk the table's own order: its section, search and sort.
  const libraryValues = { totalSecondsByProject: library.totals, lastActivityByProject: library.lastDays, locale: localeForDisplayLanguage(effectiveLanguage) };
  const stepOrder = selectedProject
    ? projectLibraryOrder(props.projects, selectedProject.status === "archived" ? "archived" : "active", libraryView, libraryValues)
    : [];
  const stepIndex = selectedProject ? stepOrder.findIndex((project) => project.id === selectedProject.id) : -1;
  const stepTo = (offset: number) => {
    const next = stepOrder[stepIndex + offset];
    if (next) selectProject(next.id, "replace");
  };

  // Entering or leaving a project's detail, by its buttons or the window's back
  // and forward, starts the detail at this week and returns the table to the
  // page that holds the project last shown.
  const lastShownPage = useRef<number | null>(null);
  const shownPage = selectedProject && selectedProject.status !== "archived" && stepIndex >= 0 ? projectLibraryPageOf(stepIndex) : null;
  useEffect(() => {
    if (shownPage !== null) lastShownPage.current = shownPage;
  }, [shownPage]);
  const detailOpen = selectedProjectId !== null;
  useEffect(() => {
    setRangeMode("week");
    setWindowOffset(0);
    const landing = lastShownPage.current;
    if (!detailOpen && landing !== null) setLibraryView((current) => ({ ...current, page: landing }));
  }, [detailOpen]);

  const returnToProjectLibrary = () => selectProject(null, "back");

  const openProject = (projectId: string) => selectProject(projectId, "push");

  // A project made in the dialog: once the library holds it, the table clears
  // its search, shows the page that holds it and marks its row for a moment.
  const justMadeIndex = justMadeId
    ? projectLibraryOrder(props.projects, "active", { query: "", sort: libraryView.sort }, libraryValues).findIndex((project) => project.id === justMadeId)
    : -1;
  useEffect(() => {
    if (justMadeIndex < 0) return;
    const page = projectLibraryPageOf(justMadeIndex);
    setLibraryView((current) => (current.query === "" && current.page === page ? current : { ...current, query: "", page }));
  }, [justMadeIndex]);
  useEffect(() => {
    if (!justMadeId) return undefined;
    const timer = window.setTimeout(() => setJustMadeId(null), JUST_MADE_MARK_MS);
    return () => window.clearTimeout(timer);
  }, [justMadeId]);

  return (
    <div className="page projects-page">
      <ModalPresence>
        {newDialogOpen && props.onSaveProject ? (
          <NewProjectDialog
            projects={props.projects}
            onCreate={props.onSaveProject}
            onClose={(createdId) => {
              setNewDialogOpen(false);
              if (createdId) setJustMadeId(createdId);
            }}
          />
        ) : null}
      </ModalPresence>
      <div className="pg-head projects-page__head">
        {selectedProject ? (
          // The detail keeps the Projects title where the table has it; the way back,
          // the project and its place in the table sit on the line under it.
          <div className="projects-page__detail-title">
            <h1>{t("projects.title")}</h1>
            <div className="projects-page__detail-nav">
              <button
                type="button"
                className="projects-page__back"
                aria-label={t("projects.backToList")}
                title={t("projects.backToList")}
                onClick={returnToProjectLibrary}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </button>
              <h2 className="projects-page__detail-name">
                <ProjectSwitcher
                  current={selectedProject}
                  projects={stepOrder.length > 0 ? stepOrder : [selectedProject]}
                  onPick={(projectId) => selectProject(projectId, "replace")}
                />
              </h2>
              {selectedProject.status === "archived" ? <span className="chip gray">{t("common.archived")}</span> : null}
              {stepIndex >= 0 ? (
                <span className="projects-page__stepper">
                  <span className="projects-page__position">{stepIndex + 1} / {stepOrder.length}</span>
                  <button
                    type="button"
                    className="projects-page__step"
                    aria-label={t("projects.previousProject")}
                    title={t("projects.previousProject")}
                    disabled={stepIndex === 0}
                    onClick={() => stepTo(-1)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </button>
                  <button
                    type="button"
                    className="projects-page__step"
                    aria-label={t("projects.nextProject")}
                    title={t("projects.nextProject")}
                    disabled={stepIndex === stepOrder.length - 1}
                    onClick={() => stepTo(1)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
                  </button>
                </span>
              ) : null}
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
      ) : props.projects.length === 0 && props.projectsLoading ? (
        // The library is still loading: hold the table's place instead of the
        // empty page, which would offer a first project to someone who has some.
        <>
          {locked ? (
            <ProjectsReconnect
              reason={props.lockReason ?? "disconnected"}
              onPickCloud={() => void props.onPickIntelligence?.("cloud")}
              onOpenSettings={props.onConfigureModel}
            />
          ) : null}
          <ProjectsManagerLoading totalCaption={t("projects.latestDays", { count: PROJECT_LIBRARY_WINDOW_DAYS })} />
        </>
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
            onCreateProject={locked ? undefined : requestNewProject}
            highlightProjectId={justMadeId}
            view={libraryView}
            onViewChange={setLibraryView}
            onOpenProject={openProject}
            busy={props.running || props.projectsLoading}
            valuesLoading={!trendReady}
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
              <ProjectsSharePanel projects={shareProjects} days={PROJECT_LIBRARY_WINDOW_DAYS} loadingRows={trendReady ? undefined : Math.min(activeProjects.length, 4)} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
