import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AiReviewEvent,
  type Project,
  type ProjectAnchor,
  type ProjectAssignmentRecord,
  type ProjectInput,
  type ProjectPassRun,
  type TrackerApi,
} from "@drifty/domain";
import { NO_PROJECT_COLOR, projectColorBySegment as deriveColorBySegment, projectColorMap, projectFlowLegend, type ProjectLegendEntry } from "../flow-chart/projectFlowView";
import type { AnalysisAiSetupState } from "../settings/analysisModelSetup";
import { createProjectPassInference } from "./projectPassInference";
import { resolveClassificationWorkProfileForPrompt } from "./aiClassificationService";
import { runProjectPass, type ProjectPassSummary } from "./aiProjectReviewService";
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
  readonly assignments: ProjectAssignmentRecord[];
  /** Project assignments across the whole Trends insight window (empty when no insightRange). */
  readonly insightAssignments: ProjectAssignmentRecord[];
  readonly projectColorBySegment: Map<string, string>;
  readonly projectLegend: ProjectLegendEntry[];
  readonly projectModeAvailable: boolean;
  readonly passRuns: ProjectPassRun[];
  readonly aiReviewEvents: AiReviewEvent[];
  readonly running: boolean;
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly lastRunSummary: ProjectPassSummary | null;
  readonly runError: string | null;
  readonly revertReviewEvent: (id: number) => Promise<void>;
  readonly saveProject: (input: ProjectInput) => Promise<void>;
  readonly deleteProject: (id: string) => Promise<void>;
  readonly addAnchor: (projectId: string, kind: ProjectAnchor["kind"], value: string) => Promise<void>;
  readonly deleteAnchor: (projectId: string, kind: ProjectAnchor["kind"], value: string) => Promise<void>;
  readonly runPassNow: (range?: { start: string; end: string }) => Promise<void>;
  /**
   * Quiet background pass for the scheduler (Item 1). Unlike runPassNow it never
   * touches the manual-run UI state (running/progress/runError), and returns only
   * privacy-safe diagnostics so a periodic/on-open tick can never disrupt the user
   * or expose provider errors.
   */
  readonly runScheduledPass: (trigger: "schedule" | "open" | "eod", range: { start: string; end: string }) => Promise<ScheduledProjectPassOutcome>;
  readonly backfillLast7Days: () => Promise<void>;
  readonly reload: () => Promise<void>;
}

function last7DaysRange(now: string): { start: string; end: string } {
  const end = now;
  const start = new Date(Date.parse(now) - 7 * 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

export function useProjectClassification(args: UseProjectClassificationArgs): UseProjectClassificationResult {
  const { tracker, selectedDayRange, analysisSetup, resolveOpenRouterKey, analysisConnected } = args;
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
  const [assignments, setAssignments] = useState<ProjectAssignmentRecord[]>([]);
  const [insightAssignments, setInsightAssignments] = useState<ProjectAssignmentRecord[]>([]);
  const [passRuns, setPassRuns] = useState<ProjectPassRun[]>([]);
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
      setProjects((await tracker.getProjects?.()) ?? []);
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, [tracker]);

  const loadAssignments = useCallback(async () => {
    const requestId = ++assignmentsRequestRef.current;
    const isCurrentRequest = () => (
      isMountedRef.current && assignmentsRequestRef.current === requestId
    );

    if (selectedDayRangeStart === null || selectedDayRangeEnd === null) {
      if (isCurrentRequest()) setAssignments([]);
      return;
    }

    try {
      const nextAssignments = await tracker.getProjectAssignments?.({
        start: selectedDayRangeStart,
        end: selectedDayRangeEnd,
      });
      if (isCurrentRequest()) setAssignments(nextAssignments ?? []);
    } catch {
      if (isCurrentRequest()) setAssignments([]);
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
      if (isCurrentRequest()) setInsightAssignments([]);
      return;
    }

    try {
      const nextAssignments = await tracker.getProjectAssignments?.({
        start: insightRangeStart,
        end: insightRangeEnd,
      });
      if (isCurrentRequest()) setInsightAssignments(nextAssignments ?? []);
    } catch {
      if (isCurrentRequest()) setInsightAssignments([]);
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
  }, [loadProjects, loadPassRuns]);

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
    () => projects.some((project) => project.status === "active") && assignments.length > 0,
    [projects, assignments],
  );

  const buildInference = useCallback(async () => {
    const setup = { ...analysisSetup };
    if (setup.provider === "openrouter") {
      setup.openRouterApiKey = (await resolveOpenRouterKey()) ?? "";
    }
    return createProjectPassInference(setup);
  }, [analysisSetup, resolveOpenRouterKey]);

  const runPassNow = useCallback(
    async (range?: { start: string; end: string }) => {
      const effectiveRange = range ?? selectedDayRangeValue;
      if (!effectiveRange || !analysisConnected) return;
      setRunning(true);
      setRunError(null);
      setProgress(null);
      try {
        const inference = await buildInference();
        // Privacy-gated; never let a work-profile read failure block the pass.
        const workProfile = await resolveClassificationWorkProfileForPrompt(true).catch(() => null);
        const summary = await runProjectPass({
          range: effectiveRange,
          trigger: range ? "backfill" : "manual",
          tracker,
          inference,
          now,
          workProfile,
          startOfDayMinutes: args.startOfDayMinutes,
          onProgress: (done, total) => setProgress({ done, total }),
        });
        setLastRunSummary(summary);
        // A pass can "succeed" with nothing to show — surface that instead of
        // silently returning to the button so the user isn't left guessing.
        if (!summary.ran) {
          setRunError(summary.skippedReason ? `Nothing to analyze — ${summary.skippedReason}.` : "Nothing to analyze in this range.");
        } else if (summary.assignments === 0 && summary.corrections === 0) {
          setRunError("The analysis model returned no results. Check that your Intelligence model is set up (API key + model) under Configure in AI setup, then try again.");
        }
        await Promise.all([loadAssignments(), loadInsightAssignments(), loadPassRuns()]);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : String(error));
      } finally {
        setRunning(false);
        setProgress(null);
      }
    },
    [selectedDayRangeValue, analysisConnected, buildInference, tracker, now, args.startOfDayMinutes, loadAssignments, loadInsightAssignments, loadPassRuns],
  );

  const runScheduledPass = useCallback(
    async (trigger: "schedule" | "open" | "eod", range: { start: string; end: string }): Promise<ScheduledProjectPassOutcome> => {
      if (!analysisConnected) {
        return { status: "skipped", reason: "analysis_disconnected" };
      }

      try {
        const inference = await buildInference();
        const workProfile = await resolveClassificationWorkProfileForPrompt(true).catch(() => null);
        const summary = await runProjectPass({
          range,
          trigger,
          tracker,
          inference,
          now,
          workProfile,
          startOfDayMinutes: args.startOfDayMinutes,
        });
        // Only refresh views when the pass actually did work; the chunk-fingerprint
        // skip makes a no-op tick cheap and silent. The service inFlight lock
        // coalesces this with any concurrent manual run.
        if (summary.ran) {
          await Promise.all([loadAssignments(), loadInsightAssignments(), loadPassRuns()]);
          return { status: "completed", summary };
        }

        return { status: "skipped", reason: "no_work" };
      } catch (error) {
        // Background tick: never surface an error or disturb the manual-run UI.
        // Convert potentially sensitive failures immediately to a bounded category.
        return { status: "failed", category: scheduledProjectPassFailureCategory(error) };
      }
    },
    [analysisConnected, buildInference, tracker, now, args.startOfDayMinutes, loadAssignments, loadInsightAssignments, loadPassRuns],
  );

  // Mutations swallow their own errors (surfacing via runError) so a failed
  // tracker call never escapes as an unhandled rejection — the app's global
  // handler replaces the whole UI with an error screen on any such rejection.
  const saveProject = useCallback(
    async (input: ProjectInput) => {
      try {
        await tracker.saveProject(input);
        await loadProjects();
      } catch (error) {
        setRunError(error instanceof Error ? error.message : String(error));
      }
    },
    [tracker, loadProjects],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        await tracker.deleteProject(id);
        await Promise.all([loadProjects(), loadAssignments(), loadInsightAssignments()]);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : String(error));
      }
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

  const backfillLast7Days = useCallback(async () => {
    await runPassNow(last7DaysRange(now()));
  }, [runPassNow]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    await Promise.all([loadProjects(), loadAssignments(), loadInsightAssignments(), loadPassRuns()]);
  }, [loadProjects, loadAssignments, loadInsightAssignments, loadPassRuns]);

  return {
    projects,
    projectsLoading,
    assignments,
    insightAssignments,
    projectColorBySegment: projectColorBySegmentMap,
    projectLegend,
    projectModeAvailable,
    passRuns,
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
