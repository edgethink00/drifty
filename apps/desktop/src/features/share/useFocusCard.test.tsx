// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusCard } from "./useFocusCard";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  buildPayload: vi.fn(),
  publish: vi.fn(),
  refreshAggregates: vi.fn(),
  fetchOwn: vi.fn(),
}));

vi.mock("./focusCardPublisher", () => ({
  buildFocusCardPayloadFromTracker: mocks.buildPayload,
}));

vi.mock("./focusCardService", () => ({
  captureFocusCardConsent: mocks.capture,
  DEFAULT_FOCUS_CARD_DETAIL_FLAGS: {
    shareCategoryBreakdown: false,
    shareHourlyPattern: false,
  },
  fetchOwnFocusCard: mocks.fetchOwn,
  publishFocusCard: mocks.publish,
  refreshFocusCardAggregates: mocks.refreshAggregates,
  setFocusCardDetailFlags: vi.fn().mockResolvedValue({ success: true }),
  setFocusCardEnabled: vi.fn().mockResolvedValue({ success: true }),
}));

describe("useFocusCard classification assessment gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capture.mockResolvedValue({ success: true, data: "revision-a" });
    mocks.buildPayload.mockResolvedValue({ focusSeconds7d: 3_600 });
    mocks.publish.mockResolvedValue({ success: true });
    mocks.fetchOwn.mockResolvedValue({ success: true, data: null });
    mocks.refreshAggregates.mockResolvedValue({ success: true });
  });

  it("keeps published aggregates unchanged when the compact read fails", async () => {
    mocks.buildPayload.mockRejectedValueOnce(new Error("tracker_timeline_too_large"));
    const { result } = renderHook(() => useFocusCard({
      userId: "qa-owner", windowEndDay: "2026-11-14", startOfDayMinutes: 0,
      includeAiClassifications: true, classificationAssessmentReady: true,
    }));
    await act(async () => { expect(await result.current.enable()).toBe(false); });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.refreshAggregates).not.toHaveBeenCalled();
  });

  it("keeps the public aggregate unchanged while AI classification is pending", async () => {
    const { result } = renderHook(() => useFocusCard({
      userId: "owner-a", windowEndDay: "2026-09-04",
      startOfDayMinutes: 0,
      includeAiClassifications: true,
      classificationAssessmentReady: false,
    }));

    let enabled = true;
    await act(async () => {
      enabled = await result.current.enable();
    });

    expect(enabled).toBe(false);
    expect(result.current.error).toMatch(/Reconnect AI/i);
    expect(mocks.buildPayload).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("publishes normally once the corrected assessment is ready", async () => {
    const { result } = renderHook(() => useFocusCard({
      userId: "owner-a", windowEndDay: "2026-09-04",
      startOfDayMinutes: 0,
      includeAiClassifications: true,
      classificationAssessmentReady: true,
    }));

    await act(async () => {
      expect(await result.current.enable()).toBe(true);
    });

    expect(mocks.buildPayload).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenCalledOnce();
  });

  it("abandons an in-flight payload when assessment readiness closes before publish", async () => {
    let resolvePayload: ((payload: { focusSeconds7d: number }) => void) | null = null;
    mocks.buildPayload.mockReturnValueOnce(new Promise((resolve) => {
      resolvePayload = resolve;
    }));
    const { result, rerender } = renderHook(
      (props: { ready: boolean }) => useFocusCard({
        userId: "owner-a", windowEndDay: "2026-09-04",
        startOfDayMinutes: 0,
        includeAiClassifications: true,
        classificationAssessmentReady: props.ready,
      }),
      { initialProps: { ready: true } },
    );

    let enablePromise: Promise<boolean> | null = null;
    act(() => {
      enablePromise = result.current.enable();
    });
    await vi.waitFor(() => expect(mocks.buildPayload).toHaveBeenCalledOnce());
    rerender({ ready: false });

    let enabled = true;
    await act(async () => {
      resolvePayload?.({ focusSeconds7d: 3_600 });
      enabled = await (enablePromise ?? Promise.resolve(true));
    });

    expect(enabled).toBe(false);
    expect(result.current.error).toMatch(/Reconnect AI/i);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("does not reuse a payload after assessment pauses and becomes ready again", async () => {
    let resolvePayload: ((payload: { focusSeconds7d: number }) => void) | null = null;
    mocks.buildPayload.mockReturnValueOnce(new Promise((resolve) => {
      resolvePayload = resolve;
    }));
    const { result, rerender } = renderHook(
      (props: { ready: boolean }) => useFocusCard({
        userId: "owner-a", windowEndDay: "2026-09-04",
        startOfDayMinutes: 0,
        includeAiClassifications: true,
        classificationAssessmentReady: props.ready,
      }),
      { initialProps: { ready: true } },
    );

    let enablePromise: Promise<boolean> | null = null;
    act(() => {
      enablePromise = result.current.enable();
    });
    await vi.waitFor(() => expect(mocks.buildPayload).toHaveBeenCalledOnce());
    rerender({ ready: false });
    rerender({ ready: true });

    let enabled = true;
    await act(async () => {
      resolvePayload?.({ focusSeconds7d: 3_600 });
      enabled = await (enablePromise ?? Promise.resolve(true));
    });

    expect(enabled).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("refreshes an enabled card from the recomputed payload while assessment is ready", async () => {
    mocks.fetchOwn.mockResolvedValue({ success: true, data: { enabled: true } });
    const { result } = renderHook(() => useFocusCard({ userId: "owner-a", windowEndDay: "2026-09-04",
      startOfDayMinutes: 0, includeAiClassifications: true, classificationAssessmentReady: true }));
    await act(async () => { await result.current.refresh(); });
    expect(mocks.refreshAggregates).toHaveBeenCalledWith({ focusSeconds7d: 3_600 }, undefined, "owner-a");
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("does not publish a disabled card during post-delete refresh", async () => {
    mocks.fetchOwn.mockResolvedValue({ success: true, data: { enabled: false } });
    const { result } = renderHook(() => useFocusCard({ userId: "owner-a", windowEndDay: "2026-09-04",
      startOfDayMinutes: 0, includeAiClassifications: true, classificationAssessmentReady: true }));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.enabled).toBe(false);
    expect(mocks.refreshAggregates).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("preserves the assessment pause gate during post-delete refresh", async () => {
    mocks.fetchOwn.mockResolvedValue({ success: true, data: { enabled: true } });
    const { result } = renderHook(() => useFocusCard({ userId: "owner-a", windowEndDay: "2026-09-04",
      startOfDayMinutes: 0, includeAiClassifications: true, classificationAssessmentReady: false }));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toMatch(/AI classification is paused/i);
    expect(mocks.refreshAggregates).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

});
