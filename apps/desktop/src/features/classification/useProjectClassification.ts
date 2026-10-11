import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeProjectColor } from "../../lib/colorPalette";
import { subscribeTeamProjectMirrorChanged } from "../../lib/teamProjectMirrorEvents";
import {
  type AiReviewEvent,
  type Project,
  type ProjectAnchor,
  type ProjectAssignmentRecord,
  type ProjectInput,
  type ProjectPassRun,
  type ProjectWindowAssignmentRecord,
  type TrackerApi,
} from "@drifty/domain";
import { NO_PROJECT_COLOR, projectColorBySegment as deriveColorBySegment, projectColorMap, projectFlowLegend, type ProjectLegendEntry } from "../flow-chart/projectFlowView";
import type { AnalysisAiSetupState } from "../settings/analysisModelSetup";
import { createProjectPassInference } from "./projectPassInference";
import { resolveClassificationWorkProfileForPrompt } from "./aiClassificationService";
import { runProjectPass, type ProjectPassSummary } from "./aiProjectReviewService";
import { readAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";

/** Canonical project-pass run messages; ProjectsPage localizes them for display. */
export const PROJECT_PASS_NO_RESULTS_MESSAGE = "The analysis model returned no results. Check the API key and model under AI settings › Intelligence, then try again.";
export const PROJECT_PASS_NOTHING_TO_ANALYZE_MESSAGE = "Nothing to analyze in this range.";
export const PROJECT_PASS_NOTHING_TO_ANALYZE_PREFIX = "Nothing to analyze — ";
export type ScheduledProjectPassFailureCategory =
  | "configuration"
  | "network"
  | "provider_error"
  | "timeout"
  | "tracker_unavailable"
  | "unknown";

export type ScheduledProjectPassOutcome =
  | {
    readonly status: "completed";
    readonly summary: ProjectPassSummary;
  }
  | {
    readonly status: "skipped";
    readonly reason: "analysis_disconnected" | "no_work";
  }
  | {
    readonly status: "failed";
    readonly category: ScheduledProjectPassFailureCategory;
  };

function scheduledProjectPassFailureCategory(error: unknown): ScheduledProjectPassFailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("api key") || message.includes("not configured") || message.includes("configuration")) {
    return "configuration";
  }
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("network") || message.includes("fetch") || message.includes("offline")) return "network";
  if (message.includes("tracker") || message.includes("sidecar") || message.includes("database")) {
    return "tracker_unavailable";
  }
  if (
    message.includes("provider")
    || message.includes("openrouter")
    || message.includes("openai")
    || message.includes("anthropic")
    || message.includes("model")
    || message.includes("http")
  ) {
    return "provider_error";
  }
  return "unknown";
}


export interface UseProjectClassificationArgs {
  readonly tracker: TrackerApi;
  readonly selectedDayRange: { readonly start: string; readonly end: string } | null;
  readonly startOfDayMinutes: number;
  readonly analysisSetup: AnalysisAiSetupState;
  readonly requestScopeKey?: string;
  readonly analysisOwnerId?: string | null;
  readonly analysisCloudRecovery?: boolean;
  readonly canFallbackToCloud?: () => boolean;
  readonly onProviderUnavailable?: (reason: import("../settings/intelligenceRouting").AnalysisUnavailableReason) => void;
  /** Resolve the OpenRouter provisioned key from the Keychain (null when none). */
  readonly resolveOpenRouterKey: () => Promise<string | null>;
  /** Whether the analysis model is configured enough to run the pass. */
  readonly analysisConnected: boolean;
  /** Called after a revert changes stored classifications, so the caller can refetch. */
  readonly onClassificationChanged?: () => void;
  readonly now?: () => string;
  /**
   * Trends insight window. When set, project assignments for the WHOLE window are
   * loaded into `insightAssignments` (the weekly Project breakdown needs the full
   * range, not just the selected day covered by `selectedDayRange`).
   */
  readonly insightRange?: { readonly start: string; readonly end: string } | null;
}

export interface UseProjectClassificationResult {
  readonly projects: Project[];
  readonly projectsLoading: boolean;
  /**
   * Active team projects in the local mirror. The pass classifies against personal
   * and team projects together, so a member with only team projects still needs it.
   */
  readonly activeTeamProjectCount: number;
  readonly assignments: ProjectAssignmentRecord[];
  /** Fixed-window AI assignments for the selected day. */
  readonly windowAssignments: ProjectWindowAssignmentRecord[];
  /** Project assignments across the whole Trends insight window (empty when no insightRange). */
  readonly insightAssignments: ProjectAssignmentRecord[];
  /** Fixed-window AI assignments across the whole Trends insight window. */
  readonly insightWindowAssignments: ProjectWindowAssignmentRecord[];
  readonly projectColorBySegment: Map<string, string>;
  readonly projectLegend: ProjectLegendEntry[];
  readonly projectModeAvailable: boolean;
  readonly passRuns: ProjectPassRun[];
  /**
   * Epoch ms of the last pass observed to finish with no failed chunks, or null
   * when this session has not seen one. Freshness guards (the manual refresh
   * cooldown) key on this rather than on the newest `project_pass_runs` row: a
   * partially failed pass still records a row for cost accounting, but it did
   * NOT bring the window up to date. Recorded rows carry no failure flag, so
   * this deliberately starts null after a relaunch — offering a redundant
   * refresh is a smaller failure than locking a stale window behind a guard.
   */
  readonly lastSuccessfulPassAtMs: number | null;
  readonly aiReviewEvents: AiReviewEvent[];
  readonly running: boolean;
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly lastRunSummary: ProjectPassSummary | null;
  readonly runError: string | null;
  readonly revertReviewEvent: (id: number) => Promise<void>;
  readonly saveProject: (input: ProjectInput, onError?: (message: string) => void) => Promise<Project | null>;
  /** Resolves false after a failure. The caller that asked owns the message when it passes `onError`. */
  readonly deleteProject: (id: string, onError?: (message: string) => void) => Promise<boolean>;
  readonly addAnchor: (projectId: string, kind: ProjectAnchor["kind"], value: string) => Promise<void>;
  readonly deleteAnchor: (projectId: string, kind: ProjectAnchor["kind"], value: string) => Promise<void>;
  readonly runPassNow: (range?: { start: string; end: string }) => Promise<ProjectPassSummary | null>;
  /**
   * Quiet background pass for the scheduler (Item 1). Unlike runPassNow it never
   * touches the manual-run UI state (running/progress/runError), and returns only
   * privacy-safe diagnostics so a periodic/on-open tick can never disrupt the user
   * or expose provider errors.
   */
  readonly runScheduledPass: (trigger: "schedule" | "open" | "eod", range: { start: string; end: string }) => Promise<ScheduledProjectPassOutcome>;
  /**
   * Latest-7-days pass. `quiet` suppresses the run-error banner for passes the
   * user did not explicitly request (project creation), so failures surface as
   * that project's own row state instead of a raw provider message.
   */
  readonly backfillLast7Days: (options?: { readonly quiet?: boolean }) => Promise<ProjectPassSummary | null>;
  readonly reload: () => Promise<void>;
}

function last7DaysRange(now: string): { start: string; end: string } {
  const end = now;
  const start = new Date(Date.parse(now) - 7 * 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

export function useProjectClassification(args: UseProjectClassificationArgs): UseProjectClassificationResult {
  const { tracker, selectedDayRange, analysisSetup, resolveOpenRouterKey, analysisConnected } = args;
  const currentScope = useRef(args.requestScopeKey);
  currentScope.current = args.requestScopeKey;
  const now = args.now ?? (() => new Date().toISOString());

  const selectedDayRangeStart = selectedDayRange?.start ?? null;
  const selectedDayRangeEnd = selectedDayRange?.end ?? null;
  const insightRangeStart = args.insightRange?.start ?? null;
  const insightRangeEnd = args.insightRange?.end ?? null;
  const selectedDayRangeValue = useMemo(
    () => (
      selectedDayRangeStart === null || selectedDayRangeEnd === null
        ? null
        : { start: selectedDayRangeStart, end: selectedDayRangeEnd }
    ),
    [selectedDayRangeStart, selectedDayRangeEnd],
  );

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [activeTeamProjectCount, setActiveTeamProjectCount] = useState(0);
  const [assignments, setAssignments] = useState<ProjectAssignmentRecord[]>([]);
  const [windowAssignments, setWindowAssignments] = useState<ProjectWindowAssignmentRecord[]>([]);
  const [insightAssignments, setInsightAssignments] = useState<ProjectAssignmentRecord[]>([]);
  const [insightWindowAssignments, setInsightWindowAssignments] = useState<ProjectWindowAssignmentRecord[]>([]);
  const [passRuns, setPassRuns] = useState<ProjectPassRun[]>([]);
  const [lastSuccessfulPassAtMs, setLastSuccessfulPassAtMs] = useState<number | null>(null);
  const [aiReviewEvents, setAiReviewEvents] = useState<AiReviewEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ readonly done: number; readonly total: number } | null>(null);
  const [lastRunSummary, setLastRunSummary] = useState<ProjectPassSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const assignmentsRequestRef = useRef(0);
  const reviewEventsRequestRef = useRef(0);
  const insightAssignmentsRequestRef = useRef(0);
  const isMountedRef = useRef(false);

  useEffect(() => {
    setRunning(false);
    setProgress(null);
    setRunError(null);
    setLastRunSummary(null);
  }, [args.requestScopeKey]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      assignmentsRequestRef.current += 1;
      reviewEventsRequestRef.current += 1;
      insightAssignmentsRequestRef.current += 1;
    };
  }, []);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      // Legacy vivid colors resolve to their palette slot here, so every consumer
      // (rows, legends, charts) sees one palette without a data migration.
      setProjects(((await tracker.getProjects?.()) ?? []).map((project) => ({ ...project, color: normalizeProjectColor(project.color) })));
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, [tracker]);

  const loadTeamProjectCount = useCallback(async () => {
    try {
      const teamProjects = (await tracker.getTeamProjects?.()) ?? [];
      if (!isMountedRef.current) return;
      setActiveTeamProjectCount(teamProjects.filter((project) => project.status === "active").length);
    } catch {
      // Keep the last known count: a transient read failure must not stop analysis.
    }
  }, [tracker]);

  const loadAssignments = useCallback(async () => {
    const requestId = ++assignmentsRequestRef.current;
    const isCurrentRequest = () => (
      isMountedRef.current && assignmentsRequestRef.current === requestId
    );

    if (selectedDayRangeStart === null || selectedDayRangeEnd === null) {
      if (isCurrentRequest()) {
        setAssignments([]);
        setWindowAssignments([]);
      }
      return;
    }

    try {
      const range = { start: selectedDayRangeStart, end: selectedDayRangeEnd };
      const [nextAssignments, nextWindowAssignments] = await Promise.all([
        tracker.getProjectAssignments?.(range),
        tracker.getProjectWindowAssignments(range),
      ]);
      if (isCurrentRequest()) {
        setAssignments(nextAssignments ?? []);
        setWindowAssignments(nextWindowAssignments ?? []);
      }
    } catch {
      if (isCurrentRequest()) {
        setAssignments([]);
        setWindowAssignments([]);
      }
    }
  }, [tracker, selectedDayRangeStart, selectedDayRangeEnd]);

  // Keyed on primitive range bounds so an inline range object from the caller
  // neither re-fires every render nor validates an older request.
  const loadInsightAssignments = useCallback(async () => {
    const requestId = ++insightAssignmentsRequestRef.current;
    const isCurrentRequest = () => (
      isMountedRef.current && insightAssignmentsRequestRef.current === requestId
    );

    if (!insightRangeStart || !insightRangeEnd) {
      if (isCurrentRequest()) {
        setInsightAssignments([]);
        setInsightWindowAssignments([]);
      }
      return;
    }

    try {
      const range = { start: insightRangeStart, end: insightRangeEnd };
      const [nextAssignments, nextWindowAssignments] = await Promise.all([
        tracker.getProjectAssignments?.(range),
        tracker.getProjectWindowAssignments(range),
      ]);
      if (isCurrentRequest()) {
        setInsightAssignments(nextAssignments ?? []);
        setInsightWindowAssignments(nextWindowAssignments ?? []);
      }
    } catch {
      if (isCurrentRequest()) {
        setInsightAssignments([]);
        setInsightWindowAssignments([]);
      }
    }
  }, [tracker, insightRangeStart, insightRangeEnd]);

  const loadPassRuns = useCallback(async () => {
    try {
      setPassRuns((await tracker.getProjectPassRuns?.({ start: last7DaysRange(now()).start, end: now() })) ?? []);
    } catch {
      setPassRuns([]);
    }
  }, [tracker]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadReviewEvents = useCallback(async () => {
    const requestId = ++reviewEventsRequestRef.current;
    const isCurrentRequest = () => (
      isMountedRef.current && reviewEventsRequestRef.current === requestId
    );

    if (selectedDayRangeStart === null || selectedDayRangeEnd === null) {
      if (isCurrentRequest()) setAiReviewEvents([]);
      return;
    }

    try {
      const nextReviewEvents = await tracker.getAiReviewEvents?.({
        start: selectedDayRangeStart,
        end: selectedDayRangeEnd,
      });
      if (isCurrentRequest()) setAiReviewEvents(nextReviewEvents ?? []);
    } catch {
      if (isCurrentRequest()) setAiReviewEvents([]);
    }
  }, [tracker, selectedDayRangeStart, selectedDayRangeEnd]);

  const revertReviewEvent = useCallback(
    async (id: number) => {
      try {
        await tracker.revertAiReviewEvent(id);
        await loadReviewEvents();
        args.onClassificationChanged?.();
      } catch (error) {
        setRunError(error instanceof Error ? error.message : String(error));
      }
    },
    [tracker, loadReviewEvents, args],
  );

  useEffect(() => {
    void loadProjects();
    void loadPassRuns();
    void loadTeamProjectCount();
  }, [loadProjects, loadPassRuns, loadTeamProjectCount]);

  useEffect(() => subscribeTeamProjectMirrorChanged(() => {
    void loadTeamProjectCount();
  }), [loadTeamProjectCount]);

  useEffect(() => {
    void loadAssignments();
    void loadReviewEvents();
  }, [loadAssignments, loadReviewEvents]);

  useEffect(() => {
    void loadInsightAssignments();
  }, [loadInsightAssignments]);

  const colors = useMemo(() => projectColorMap(projects), [projects]);
  const projectColorBySegmentMap = useMemo(() => deriveColorBySegment(assignments, colors), [assignments, colors]);
  const projectLegend = useMemo(() => projectFlowLegend(projects, assignments), [projects, assignments]);
  const projectModeAvailable = useMemo(
    () => projects.some((project) => project.status === "active") && (assignments.length > 0 || windowAssignments.length > 0),
    [projects, assignments, windowAssignments],
  );

  const buildInference = useCallback(async () => {
    const setup = { ...analysisSetup };
    if (setup.provider === "openrouter") {
      setup.openRouterApiKey = (await resolveOpenRouterKey()) ?? "";
    }
    return createProjectPassInference(setup, {
      isRequestCurrent: () => isMountedRef.current && currentScope.current === args.requestScopeKey,
      expectedCloudUserId: args.analysisOwnerId,
      cloudRecovery: args.analysisCloudRecovery,
      canFallbackToCloud: args.canFallbackToCloud,
      onProviderUnavailable: args.onProviderUnavailable,
    });
  }, [analysisSetup, resolveOpenRouterKey, args.requestScopeKey, args.analysisOwnerId, args.analysisCloudRecovery, args.canFallbackToCloud, args.onProviderUnavailable]);

  const runForegroundPass = useCallback(
    async (
      effectiveRange: { start: string; end: string },
      options: { readonly trigger: "manual" | "backfill"; readonly quiet?: boolean },
    ): Promise<ProjectPassSummary | null> => {
      if (!analysisConnected) return null;
      setRunning(true);
      setRunError(null);
      setProgress(null);
      const isCurrent = () => isMountedRef.current && currentScope.current === args.requestScopeKey;
      try {
        const inference = await buildInference();
        const privacySettings = readAiPrivacyRequestSettings();
        // Privacy-gated; never let a work-profile read failure block the pass.
        const workProfile = await resolveClassificationWorkProfileForPrompt(privacySettings.optional.workProfile).catch(() => null);
        const summary = await runProjectPass({
          range: effectiveRange,
          trigger: options.trigger,
          tracker,
          inference,
          requestScopeKey: args.requestScopeKey,
          persistenceAllowed: isCurrent,
          now,
          workProfile,
          contextPolicy: {
            siteUrl: privacySettings.optional.siteUrl,
            windowTitle: privacySettings.optional.windowTitle,
            contentContext: privacySettings.optional.contentContext,
          },
          startOfDayMinutes: args.startOfDayMinutes,
          onProgress: (done, total) => { if (isCurrent()) setProgress({ done, total }); },
        });
        if (!isCurrent()) return null;
        setLastRunSummary(summary);
        // Only a clean pass makes the window fresh; a partially failed one must
        // not start a cooldown that hides the retry the user needs.
        if (summary.ran && summary.failedChunks === 0) setLastSuccessfulPassAtMs(Date.now());
        // A pass can "succeed" with nothing to show — surface that instead of
        // silently returning to the button so the user isn't left guessing.
        if (!options.quiet && !summary.ran && summary.skippedReason !== "already analyzed") {
          setRunError(summary.skippedReason ? `${PROJECT_PASS_NOTHING_TO_ANALYZE_PREFIX}${summary.skippedReason}.` : PROJECT_PASS_NOTHING_TO_ANALYZE_MESSAGE);
        } else if (
          summary.assignments === 0 && summary.corrections === 0
          && ((summary.skippedCorrections ?? 0) === 0 || summary.failedChunks > 0)
        ) {
          if (!options.quiet && summary.ran) {
            setRunError(PROJECT_PASS_NO_RESULTS_MESSAGE);
          }
        }
        await Promise.all([loadAssignments(), loadInsightAssignments(), loadPassRuns()]);
        return summary;
      } catch (error) {
        // A pass the user did not ask for reports through the project's own row
        // state, never through a banner carrying a raw provider/transport message.
        if (!options.quiet && isCurrent()) setRunError(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        if (isCurrent()) {
          setRunning(false);
          setProgress(null);
        }
      }
    },
    [analysisConnected, buildInference, tracker, now, args.requestScopeKey, args.startOfDayMinutes, loadAssignments, loadInsightAssignments, loadPassRuns],
  );

  const runPassNow = useCallback(
    async (range?: { start: string; end: string }): Promise<ProjectPassSummary | null> => {
      const effectiveRange = range ?? selectedDayRangeValue;
      if (!effectiveRange) return null;
      return runForegroundPass(effectiveRange, { trigger: range ? "backfill" : "manual" });
    },
    [runForegroundPass, selectedDayRangeValue],
  );

  const runScheduledPass = useCallback(
    async (trigger: "schedule" | "open" | "eod", range: { start: string; end: string }): Promise<ScheduledProjectPassOutcome> => {
      if (!analysisConnected) {
        return { status: "skipped", reason: "analysis_disconnected" };
      }

      try {
        const inference = await buildInference();
        const privacySettings = readAiPrivacyRequestSettings();
        const workProfile = await resolveClassificationWorkProfileForPrompt(privacySettings.optional.workProfile).catch(() => null);
        const summary = await runProjectPass({
          range,
          trigger,
          tracker,
          inference,
          requestScopeKey: args.requestScopeKey,
          persistenceAllowed: () => isMountedRef.current && currentScope.current === args.requestScopeKey,
          now,
          workProfile,
          contextPolicy: {
            siteUrl: privacySettings.optional.siteUrl,
            windowTitle: privacySettings.optional.windowTitle,
            contentContext: privacySettings.optional.contentContext,
          },
          startOfDayMinutes: args.startOfDayMinutes,
        });
        // Only refresh views when the pass actually did work; the chunk-fingerprint
        // skip makes a no-op tick cheap and silent. The service inFlight lock
        // coalesces this with any concurrent manual run.
        if (summary.ran) {
          await Promise.all([loadAssignments(), loadInsightAssignments(), loadPassRuns()]);
          // Chunks that produced no usable output are provider failures, so the
          // tick must not be reported (or measured) as a clean completion.
          if (summary.failedChunks > 0) return { status: "failed", category: "provider_error" };
          setLastSuccessfulPassAtMs(Date.now());
          return { status: "completed", summary };
        }

        return { status: "skipped", reason: "no_work" };
      } catch (error) {
        // Background tick: never surface an error or disturb the manual-run UI.
        // Convert potentially sensitive failures immediately to a bounded category.
        return { status: "failed", category: scheduledProjectPassFailureCategory(error) };
      }
    },
    [analysisConnected, buildInference, tracker, now, args.requestScopeKey, args.startOfDayMinutes, loadAssignments, loadInsightAssignments, loadPassRuns],
  );

  // Mutations swallow their own errors (surfacing via runError) so a failed
  // tracker call never escapes as an unhandled rejection — the app's global
  // handler replaces the whole UI with an error screen on any such rejection.
  const saveProject = useCallback(
    async (input: ProjectInput, onError?: (message: string) => void): Promise<Project | null> => {
      try {
        const saved = await tracker.saveProject(input);
        await loadProjects();
        return saved;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The editor that asked owns the message: it keeps the draft and retries
        // in place, so the page banner would only duplicate it and then outlive
        // the retry. An unattended save still reports on the page.
        if (onError) onError(message);
        else setRunError(message);
        return null;
      }
    },
    [tracker, loadProjects],
  );

  const deleteProject = useCallback(
    async (id: string, onError?: (message: string) => void): Promise<boolean> => {
      try {
        await tracker.deleteProject(id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Like a failed save: the confirmation that asked keeps itself open and
        // retries in place, so the page banner would only repeat it.
        if (onError) onError(message);
        else setRunError(message);
        return false;
      }
      try {
        await Promise.all([loadProjects(), loadAssignments(), loadInsightAssignments()]);
      } catch (error) {
        // The project is gone; a stale view is the page's to report, not a failed delete.
        setRunError(error instanceof Error ? error.message : String(error));
      }
      return true;
    },
    [tracker, loadProjects, loadAssignments, loadInsightAssignments],
  );

  const addAnchor = useCallback(
    async (projectId: string, kind: ProjectAnchor["kind"], value: string) => {
      try {
        await tracker.saveProjectAnchors(projectId, [{ kind, value, source: "manual" }]);
        await loadProjects();
      } catch (error) {
        setRunError(error instanceof Error ? error.message : String(error));
      }
    },
    [tracker, loadProjects],
  );

  const deleteAnchor = useCallback(
    async (projectId: string, kind: ProjectAnchor["kind"], value: string) => {
      try {
        await tracker.deleteProjectAnchor(projectId, kind, value);
        await loadProjects();
      } catch (error) {
        setRunError(error instanceof Error ? error.message : String(error));
      }
    },
    [tracker, loadProjects],
  );

  const backfillLast7Days = useCallback(async (options: { readonly quiet?: boolean } = {}) => {
    return runForegroundPass(last7DaysRange(now()), { trigger: "backfill", quiet: options.quiet });
  }, [runForegroundPass]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    await Promise.all([loadProjects(), loadTeamProjectCount(), loadAssignments(), loadInsightAssignments(), loadPassRuns()]);
  }, [loadProjects, loadTeamProjectCount, loadAssignments, loadInsightAssignments, loadPassRuns]);

  return {
    projects,
    projectsLoading,
    activeTeamProjectCount,
    assignments,
    windowAssignments,
    insightAssignments,
    insightWindowAssignments,
    projectColorBySegment: projectColorBySegmentMap,
    projectLegend,
    projectModeAvailable,
    passRuns,
    lastSuccessfulPassAtMs,
    aiReviewEvents,
    running,
    progress,
    lastRunSummary,
    runError,
    revertReviewEvent,
    saveProject,
    deleteProject,
    addAnchor,
    deleteAnchor,
    runPassNow,
    runScheduledPass,
    backfillLast7Days,
    reload,
  };
}

export const PROJECT_NO_COLOR = NO_PROJECT_COLOR;
