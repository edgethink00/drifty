// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { AiReviewEvent, ProjectAssignmentRecord, TrackerApi } from "@drifty/domain";
import { describe, expect, it, vi } from "vitest";

import { useProjectClassification, type UseProjectClassificationArgs } from "./useProjectClassification";

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
