// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { AiReviewEvent, ProjectAssignmentRecord, TrackerApi } from "@drifty/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectClassification, type ScheduledProjectPassOutcome, type UseProjectClassificationArgs } from "./useProjectClassification";
import { runProjectPass, type ProjectPassSummary } from "./aiProjectReviewService";
import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { notifyTeamProjectMirrorChanged } from "../../lib/teamProjectMirrorEvents";

vi.mock("./aiProjectReviewService", () => ({
  runProjectPass: vi.fn(),
}));

const scheduledProjectPass = vi.mocked(runProjectPass);

beforeEach(() => {
  scheduledProjectPass.mockReset();
});

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createTracker() {
  const assignmentRequests: Deferred<ProjectAssignmentRecord[]>[] = [];
  const reviewEventRequests: Deferred<AiReviewEvent[]>[] = [];
  const getProjectAssignments = vi.fn(() => {
    const request = deferred<ProjectAssignmentRecord[]>();
    assignmentRequests.push(request);
    return request.promise;
  });
  const getAiReviewEvents = vi.fn(() => {
    const request = deferred<AiReviewEvent[]>();
    reviewEventRequests.push(request);
    return request.promise;
  });

  return {
    assignmentRequests,
    reviewEventRequests,
    getProjectAssignments,
    getAiReviewEvents,
    tracker: {
      getProjectAssignments,
      getProjectWindowAssignments: vi.fn(async () => []),
      getAiReviewEvents,
    } as unknown as TrackerApi,
  };
}

function renderClassification(tracker: TrackerApi, overrides: Partial<UseProjectClassificationArgs> = {}) {
  const initialProps = {
    tracker,
    selectedDayRange: null,
    insightRange: null,
    startOfDayMinutes: 0,
    analysisSetup: {} as UseProjectClassificationArgs["analysisSetup"],
    resolveOpenRouterKey: async () => null,
    analysisConnected: false,
    now: () => "2026-07-12T00:00:00.000Z",
    ...overrides,
  } satisfies UseProjectClassificationArgs;
  const hook = renderHook((props: UseProjectClassificationArgs) => useProjectClassification(props), { initialProps });
  return { hook, initialProps };
}

const rangeA = { start: "2026-07-01T00:00:00.000Z", end: "2026-07-02T00:00:00.000Z" };
const rangeB = { start: "2026-07-02T00:00:00.000Z", end: "2026-07-03T00:00:00.000Z" };
const assignmentA: ProjectAssignmentRecord = { segmentId: "segment-a", projectId: "project-a", source: "ai" };
const assignmentB: ProjectAssignmentRecord = { segmentId: "segment-b", projectId: "project-b", source: "ai" };
const reviewEventA: AiReviewEvent = { id: 1, segmentId: "segment-a", passId: 1, createdAt: "2026-07-01T00:00:00.000Z" };
const reviewEventB: AiReviewEvent = { id: 2, segmentId: "segment-b", passId: 2, createdAt: "2026-07-02T00:00:00.000Z" };

describe("useProjectClassification request ownership", () => {
  it("keeps the latest selected-day assignments and review events when range A resolves after range B", async () => {
    const { tracker, assignmentRequests, reviewEventRequests, getProjectAssignments, getAiReviewEvents } = createTracker();
    const { hook, initialProps } = renderClassification(tracker, { selectedDayRange: rangeA });
    await waitFor(() => expect(getProjectAssignments).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getAiReviewEvents).toHaveBeenCalledTimes(1));

    hook.rerender({ ...initialProps, selectedDayRange: rangeB });
    await waitFor(() => expect(getProjectAssignments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getAiReviewEvents).toHaveBeenCalledTimes(2));

    await act(async () => {
      assignmentRequests[1]!.resolve([assignmentB]);
      reviewEventRequests[1]!.resolve([reviewEventB]);
      await Promise.all([assignmentRequests[1]!.promise, reviewEventRequests[1]!.promise]);
    });
    expect(hook.result.current.assignments).toEqual([assignmentB]);
    expect(hook.result.current.aiReviewEvents).toEqual([reviewEventB]);

    await act(async () => {
      assignmentRequests[0]!.resolve([assignmentA]);
      reviewEventRequests[0]!.resolve([reviewEventA]);
      await Promise.all([assignmentRequests[0]!.promise, reviewEventRequests[0]!.promise]);
    });
    expect(hook.result.current.assignments).toEqual([assignmentB]);
    expect(hook.result.current.aiReviewEvents).toEqual([reviewEventB]);
  });

  it("keeps the latest insight assignments when range A resolves after range B", async () => {
    const { tracker, assignmentRequests, getProjectAssignments } = createTracker();
    const { hook, initialProps } = renderClassification(tracker, { insightRange: rangeA });
    await waitFor(() => expect(getProjectAssignments).toHaveBeenCalledTimes(1));

    hook.rerender({ ...initialProps, insightRange: rangeB });
    await waitFor(() => expect(getProjectAssignments).toHaveBeenCalledTimes(2));

    await act(async () => {
      assignmentRequests[1]!.resolve([assignmentB]);
      await assignmentRequests[1]!.promise;
    });
    expect(hook.result.current.insightAssignments).toEqual([assignmentB]);

    await act(async () => {
      assignmentRequests[0]!.resolve([assignmentA]);
      await assignmentRequests[0]!.promise;
    });
    expect(hook.result.current.insightAssignments).toEqual([assignmentB]);
  });

  it("does not let stale empty or error completions clear the latest selected-day data", async () => {
    const { tracker, assignmentRequests, reviewEventRequests, getProjectAssignments, getAiReviewEvents } = createTracker();
    const { hook, initialProps } = renderClassification(tracker, { selectedDayRange: rangeA });
    await waitFor(() => expect(getProjectAssignments).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getAiReviewEvents).toHaveBeenCalledTimes(1));

    hook.rerender({ ...initialProps, selectedDayRange: rangeB });
    await waitFor(() => expect(getProjectAssignments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getAiReviewEvents).toHaveBeenCalledTimes(2));

    await act(async () => {
      assignmentRequests[1]!.resolve([assignmentB]);
      reviewEventRequests[1]!.resolve([reviewEventB]);
      await Promise.all([assignmentRequests[1]!.promise, reviewEventRequests[1]!.promise]);
    });

    await act(async () => {
      assignmentRequests[0]!.resolve([]);
      reviewEventRequests[0]!.reject(new Error("stale request failed"));
      await Promise.allSettled([assignmentRequests[0]!.promise, reviewEventRequests[0]!.promise]);
    });
    expect(hook.result.current.assignments).toEqual([assignmentB]);
    expect(hook.result.current.aiReviewEvents).toEqual([reviewEventB]);
  });
});

describe("useProjectClassification scheduled passes", () => {
  it("reports a skipped outcome without invoking the pass when analysis is disconnected", async () => {
    const { tracker } = createTracker();
    const { hook } = renderClassification(tracker, { analysisConnected: false });
    let outcome!: ScheduledProjectPassOutcome;

    await act(async () => {
      outcome = await hook.result.current.runScheduledPass("schedule", rangeA);
    });

    expect(outcome).toEqual({ status: "skipped", reason: "analysis_disconnected" });
    expect(scheduledProjectPass).not.toHaveBeenCalled();
    expect(hook.result.current.running).toBe(false);
    expect(hook.result.current.progress).toBeNull();
    expect(hook.result.current.runError).toBeNull();
  });

  it("reports completion and refreshes data when the scheduled pass ran", async () => {
    const { tracker } = createTracker();
    const getProjectPassRuns = vi.fn(async () => []);
    const scheduledTracker = { ...tracker, getProjectPassRuns } as TrackerApi;
    const summary: ProjectPassSummary = {
      ran: true,
      chunks: 1,
      assignments: 2,
      corrections: 1,
      tokensIn: 10,
      tokensOut: 5,
      failedChunks: 0,
    };
    scheduledProjectPass.mockResolvedValueOnce(summary);
    const { hook } = renderClassification(scheduledTracker, { analysisConnected: true });
    await waitFor(() => expect(getProjectPassRuns).toHaveBeenCalledTimes(1));
    let outcome!: ScheduledProjectPassOutcome;

    await act(async () => {
      outcome = await hook.result.current.runScheduledPass("open", rangeA);
    });

    expect(outcome).toEqual({ status: "completed", summary });
    expect(scheduledProjectPass).toHaveBeenCalledWith(expect.objectContaining({
      range: rangeA,
      trigger: "open",
      tracker: scheduledTracker,
    }));
    expect(getProjectPassRuns).toHaveBeenCalledTimes(2);
    expect(hook.result.current.running).toBe(false);
    expect(hook.result.current.progress).toBeNull();
    expect(hook.result.current.runError).toBeNull();
  });

  it("reports a skipped outcome when the scheduled pass had no work", async () => {
    const { tracker } = createTracker();
    scheduledProjectPass.mockResolvedValueOnce({
      ran: false,
      skippedReason: "already analyzed",
      chunks: 0,
      assignments: 0,
      corrections: 0,
      tokensIn: 0,
      tokensOut: 0,
      failedChunks: 0,
    });
    const { hook } = renderClassification(tracker, { analysisConnected: true });
    let outcome!: ScheduledProjectPassOutcome;

    await act(async () => {
      outcome = await hook.result.current.runScheduledPass("eod", rangeA);
    });

    expect(outcome).toEqual({ status: "skipped", reason: "no_work" });
    expect(hook.result.current.running).toBe(false);
    expect(hook.result.current.progress).toBeNull();
    expect(hook.result.current.runError).toBeNull();
  });

  it("reports a privacy-safe failure category when the scheduled pass throws", async () => {
    const { tracker } = createTracker();
    scheduledProjectPass.mockRejectedValueOnce(new Error("OpenRouter rejected key sk-live-secret"));
    const { hook } = renderClassification(tracker, { analysisConnected: true });
    let outcome!: ScheduledProjectPassOutcome;

    await act(async () => {
      outcome = await hook.result.current.runScheduledPass("schedule", rangeA);
    });

    expect(outcome).toEqual({ status: "failed", category: "provider_error" });
    expect(JSON.stringify(outcome)).not.toContain("sk-live-secret");
    expect(hook.result.current.running).toBe(false);
    expect(hook.result.current.progress).toBeNull();
    expect(hook.result.current.runError).toBeNull();
  });
});

describe("useProjectClassification manual passes", () => {
  it("keeps an already-analyzed cache hit silent instead of reporting a model failure", async () => {
    const tracker = {
      getProjects: vi.fn(async () => []),
      getProjectAssignments: vi.fn(async () => []),
      getProjectWindowAssignments: vi.fn(async () => []),
      getAiReviewEvents: vi.fn(async () => []),
      getProjectPassRuns: vi.fn(async () => []),
    } as unknown as TrackerApi;
    const summary: ProjectPassSummary = {
      ran: false,
      skippedReason: "already analyzed",
      chunks: 1,
      assignments: 0,
      corrections: 0,
      tokensIn: 0,
      tokensOut: 0,
      failedChunks: 0,
    };
    scheduledProjectPass.mockResolvedValueOnce(summary);
    const { hook } = renderClassification(tracker, {
      analysisConnected: true,
      selectedDayRange: rangeA,
    });

    await act(async () => {
      await hook.result.current.runPassNow();
    });

    expect(hook.result.current.lastRunSummary).toEqual(summary);
    expect(hook.result.current.runError).toBeNull();
  });

  it("does not call rejected user-choice corrections an empty model response", async () => {
    const tracker = {
      getProjects: vi.fn(async () => []),
      getProjectAssignments: vi.fn(async () => []),
      getProjectWindowAssignments: vi.fn(async () => []),
      getAiReviewEvents: vi.fn(async () => []),
      getProjectPassRuns: vi.fn(async () => []),
    } as unknown as TrackerApi;
    const summary: ProjectPassSummary = {
      ran: true, chunks: 1, assignments: 0, corrections: 0, skippedCorrections: 1,
      tokensIn: 0, tokensOut: 0, failedChunks: 0,
    };
    scheduledProjectPass.mockResolvedValueOnce(summary);
    const { hook } = renderClassification(tracker, { analysisConnected: true, selectedDayRange: rangeA });
    await act(async () => { await hook.result.current.runPassNow(); });
    expect(hook.result.current.runError).toBeNull();
    expect(hook.result.current.lastRunSummary).toEqual(summary);
  });

  it("keeps an automatic pass failure out of the run-error banner", async () => {
    const tracker = {
      getProjects: vi.fn(async () => []),
      getProjectAssignments: vi.fn(async () => []),
      getProjectWindowAssignments: vi.fn(async () => []),
      getAiReviewEvents: vi.fn(async () => []),
      getProjectPassRuns: vi.fn(async () => []),
    } as unknown as TrackerApi;
    scheduledProjectPass.mockRejectedValueOnce(new Error("error sending request for url (http://127.0.0.1:8791/v1/chat/completions)"));
    const { hook } = renderClassification(tracker, { analysisConnected: true, selectedDayRange: rangeA });

    let summary: ProjectPassSummary | null = null;
    await act(async () => {
      summary = await hook.result.current.backfillLast7Days({ quiet: true });
    });

    expect(summary).toBeNull();
    expect(hook.result.current.runError).toBeNull();
    expect(hook.result.current.running).toBe(false);
  });

  it("still reports a user-requested pass failure in the banner", async () => {
    const tracker = {
      getProjects: vi.fn(async () => []),
      getProjectAssignments: vi.fn(async () => []),
      getProjectWindowAssignments: vi.fn(async () => []),
      getAiReviewEvents: vi.fn(async () => []),
      getProjectPassRuns: vi.fn(async () => []),
    } as unknown as TrackerApi;
    scheduledProjectPass.mockRejectedValueOnce(new Error("provider unavailable"));
    const { hook } = renderClassification(tracker, { analysisConnected: true, selectedDayRange: rangeA });

    await act(async () => {
      await hook.result.current.backfillLast7Days();
    });

    expect(hook.result.current.runError).toBe("provider unavailable");
  });

  it("does not mark the window fresh when a pass finished with failed chunks", async () => {
    const tracker = {
      getProjects: vi.fn(async () => []),
      getProjectAssignments: vi.fn(async () => []),
      getProjectWindowAssignments: vi.fn(async () => []),
      getAiReviewEvents: vi.fn(async () => []),
      getProjectPassRuns: vi.fn(async () => []),
    } as unknown as TrackerApi;
    // A partially failed pass still records a run row, but the window is stale.
    scheduledProjectPass.mockResolvedValueOnce({
      ran: true,
      chunks: 2,
      assignments: 0,
      corrections: 0,
      tokensIn: 10,
      tokensOut: 2,
      failedChunks: 1,
    });
    const { hook } = renderClassification(tracker, { analysisConnected: true, selectedDayRange: rangeA });

    await act(async () => {
      await hook.result.current.backfillLast7Days({ quiet: true });
    });

    expect(hook.result.current.lastSuccessfulPassAtMs).toBeNull();
  });

  it("marks the window fresh only after a clean pass", async () => {
    const tracker = {
      getProjects: vi.fn(async () => []),
      getProjectAssignments: vi.fn(async () => []),
      getProjectWindowAssignments: vi.fn(async () => []),
      getAiReviewEvents: vi.fn(async () => []),
      getProjectPassRuns: vi.fn(async () => []),
    } as unknown as TrackerApi;
    scheduledProjectPass.mockResolvedValueOnce({
      ran: true,
      chunks: 1,
      assignments: 3,
      corrections: 0,
      tokensIn: 10,
      tokensOut: 2,
      failedChunks: 0,
    });
    const { hook } = renderClassification(tracker, { analysisConnected: true, selectedDayRange: rangeA });

    await act(async () => {
      await hook.result.current.backfillLast7Days({ quiet: true });
    });

    expect(hook.result.current.lastSuccessfulPassAtMs).not.toBeNull();
  });

  it("reports a scheduled pass with failed chunks as failed, not completed", async () => {
    const { tracker } = createTracker();
    const scheduledTracker = { ...tracker, getProjectPassRuns: vi.fn(async () => []) } as TrackerApi;
    scheduledProjectPass.mockResolvedValueOnce({
      ran: true,
      chunks: 2,
      assignments: 0,
      corrections: 0,
      tokensIn: 5,
      tokensOut: 1,
      failedChunks: 2,
    });
    const { hook } = renderClassification(scheduledTracker, { analysisConnected: true });
    let outcome!: ScheduledProjectPassOutcome;

    await act(async () => {
      outcome = await hook.result.current.runScheduledPass("schedule", rangeA);
    });

    expect(outcome).toEqual({ status: "failed", category: "provider_error" });
    expect(hook.result.current.lastSuccessfulPassAtMs).toBeNull();
  });
});

describe("useProjectClassification team projects", () => {
  it("counts active team projects and recounts when the team mirror changes", async () => {
    const { tracker } = createTracker();
    const getTeamProjects = vi.fn(async () => [
      { id: "tp-1", organizationId: "team-1", name: "Release notes", status: "active" },
      { id: "tp-2", organizationId: "team-1", name: "Old launch", status: "archived" },
    ]);
    const teamTracker = { ...tracker, getTeamProjects } as unknown as TrackerApi;
    const { hook } = renderClassification(teamTracker);

    await waitFor(() => expect(hook.result.current.activeTeamProjectCount).toBe(1));

    // Leaving or deleting the team prunes the mirror and announces it.
    getTeamProjects.mockResolvedValue([]);
    act(() => notifyTeamProjectMirrorChanged());
    await waitFor(() => expect(hook.result.current.activeTeamProjectCount).toBe(0));
  });

  it("keeps the last count when the mirror cannot be read", async () => {
    const { tracker } = createTracker();
    const getTeamProjects = vi.fn(async () => [{ id: "tp-1", organizationId: "team-1", name: "Release notes", status: "active" }]);
    const teamTracker = { ...tracker, getTeamProjects } as unknown as TrackerApi;
    const { hook } = renderClassification(teamTracker);
    await waitFor(() => expect(hook.result.current.activeTeamProjectCount).toBe(1));

    getTeamProjects.mockRejectedValue(new Error("tracker unavailable"));
    act(() => notifyTeamProjectMirrorChanged());
    await waitFor(() => expect(getTeamProjects).toHaveBeenCalledTimes(2));
    expect(hook.result.current.activeTeamProjectCount).toBe(1);
  });
});


describe("Intelligence execution scope", () => {
  it("revokes persistence and hides a late foreground result after the account/configuration scope changes", async () => {
    const { tracker } = createTracker();
    const pass = deferred<ProjectPassSummary>();
    scheduledProjectPass.mockReturnValue(pass.promise);
    const { hook, initialProps } = renderClassification(tracker, { analysisSetup: DEFAULT_ANALYSIS_AI_SETUP, analysisConnected: true, requestScopeKey: "account-a/config-a" });
    let pending!: ReturnType<typeof hook.result.current.runPassNow>;
    act(() => { pending = hook.result.current.runPassNow(rangeA); });
    await waitFor(() => expect(scheduledProjectPass).toHaveBeenCalledTimes(1));
    const options = scheduledProjectPass.mock.calls[0][0];
    expect(options.persistenceAllowed?.()).toBe(true);
    hook.rerender({ ...initialProps, requestScopeKey: "account-b/config-b" });
    expect(options.persistenceAllowed?.()).toBe(false);
    await act(async () => {
      pass.resolve({ ran: true, chunks: 1, assignments: 1, corrections: 0, tokensIn: 10, tokensOut: 1, failedChunks: 0 });
      expect(await pending).toBeNull();
    });
    expect(hook.result.current.running).toBe(false);
    expect(hook.result.current.lastRunSummary).toBeNull();
    expect(hook.result.current.runError).toBeNull();
  });
});
