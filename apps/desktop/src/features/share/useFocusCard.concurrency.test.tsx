// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusCard } from "./useFocusCard";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  build: vi.fn(), refresh: vi.fn(), fetch: vi.fn(), publish: vi.fn(),
  disable: vi.fn(), flags: vi.fn(),
}));
vi.mock("./focusCardPublisher", () => ({ buildFocusCardPayloadFromTracker: mocks.build }));
vi.mock("./focusCardService", () => ({
  captureFocusCardConsent: mocks.capture,
  DEFAULT_FOCUS_CARD_DETAIL_FLAGS: { shareCategoryBreakdown: false, shareHourlyPattern: false },
  fetchOwnFocusCard: mocks.fetch, refreshFocusCardAggregates: mocks.refresh,
  publishFocusCard: mocks.publish, setFocusCardEnabled: mocks.disable,
  setFocusCardDetailFlags: mocks.flags,
}));
const INPUT = { userId: "owner-a", windowEndDay: "2026-10-04", startOfDayMinutes: 0,
  includeAiClassifications: true, classificationAssessmentReady: true };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
describe("Focus Card deletion reconciliation order", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.capture.mockResolvedValue({ success: true, data: "revision-a" });
    mocks.build.mockResolvedValue({ focusSeconds7d: 3600 });
    mocks.fetch.mockResolvedValue({ success: true, data: { enabled: true } });
    mocks.refresh.mockResolvedValue({ success: true });
    mocks.publish.mockResolvedValue({ success: true });
    mocks.disable.mockResolvedValue({ success: true });
    mocks.flags.mockResolvedValue({ success: true });
  });

  it("captures consent before building and forwards that revision without reading again", async () => {
    const snapshot = deferred<{ success: boolean; data: string }>();
    mocks.capture.mockReturnValueOnce(snapshot.promise);
    const { result } = renderHook(() => useFocusCard(INPUT));
    let enabling!: Promise<boolean>;
    await act(async () => { enabling = result.current.enable(); });
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.build).not.toHaveBeenCalled();
    await act(async () => { snapshot.resolve({ success: true, data: "captured-before-build" }); await enabling; });
    expect(mocks.publish).toHaveBeenCalledWith({ focusSeconds7d: 3600 }, true, undefined, "owner-a", "captured-before-build");
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it("binds an intent to the displayed revision and retains the atomic write response for the next choice", async () => {
    mocks.fetch.mockResolvedValue({ success: true, data: { enabled: false,
      detailFlags: { shareCategoryBreakdown: false, shareHourlyPattern: false }, consentRevision: "displayed-revision" } });
    mocks.publish.mockResolvedValueOnce({ success: true, data: "committed-revision" });
    const { result } = renderHook(() => useFocusCard(INPUT));
    await act(async () => { await result.current.refresh(); });
    await act(async () => { await result.current.enable(); });
    expect(mocks.capture).toHaveBeenLastCalledWith(undefined, "owner-a", {
      enabled: false, detailFlags: { shareCategoryBreakdown: false, shareHourlyPattern: false }, consentRevision: "displayed-revision",
    });
    await act(async () => { await result.current.setDetailFlag("shareHourlyPattern", true); });
    expect(mocks.capture).toHaveBeenLastCalledWith(undefined, "owner-a", {
      enabled: true, detailFlags: { shareCategoryBreakdown: false, shareHourlyPattern: false }, consentRevision: "committed-revision",
    });
  });

  it("does not build or write when capturing consent fails", async () => {
    mocks.capture.mockResolvedValueOnce({ success: false, error: "Review changed sharing" });
    const { result } = renderHook(() => useFocusCard(INPUT));
    let enabledSuccessfully = true;
    await act(async () => { enabledSuccessfully = await result.current.enable(); });
    expect(enabledSuccessfully).toBe(false);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Review changed sharing");
  });

  it.each(["snapshot", "payload"] as const)("invalidates an enable while its %s is pending on disable", async (stage) => {
    const snapshot = deferred<{ success: boolean; data: string }>();
    const payload = deferred<{ focusSeconds7d: number }>();
    if (stage === "snapshot") mocks.capture.mockReturnValueOnce(snapshot.promise);
    else mocks.build.mockReturnValueOnce(payload.promise);
    const { result } = renderHook(() => useFocusCard(INPUT));
    let enabling!: Promise<boolean>, disabling!: Promise<void>;
    await act(async () => { enabling = result.current.enable(); });
    await vi.waitFor(() => expect(stage === "snapshot" ? mocks.capture : mocks.build).toHaveBeenCalledOnce());
    await act(async () => { disabling = result.current.disable(); });
    expect(mocks.disable).toHaveBeenCalledWith(false, undefined, "owner-a");
    await act(async () => {
      if (stage === "snapshot") snapshot.resolve({ success: true, data: "old-revision" });
      else payload.resolve({ focusSeconds7d: 3600 });
      await Promise.all([enabling, disabling]);
    });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
  });

  it("captures a queued publication's revision before the earlier consent write completes", async () => {
    const release = deferred<{ success: boolean }>();
    mocks.publish.mockReturnValueOnce(release.promise).mockResolvedValueOnce({ success: false, error: "Stale consent" });
    mocks.capture.mockResolvedValueOnce({ success: true, data: "first-intent" })
      .mockResolvedValueOnce({ success: true, data: "queued-intent" });
    const { result } = renderHook(() => useFocusCard(INPUT));
    let first!: Promise<boolean>, queued!: Promise<boolean>;
    await act(async () => { first = result.current.enable(); });
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    await act(async () => { queued = result.current.enable(); });
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.build).toHaveBeenCalledOnce();
    await act(async () => { release.resolve({ success: true }); await Promise.all([first, queued]); });
    expect(mocks.publish.mock.calls[1][4]).toBe("queued-intent");
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe("Stale consent");
  });

  it("does not refresh consent or retry when the server rejects a stale publication", async () => {
    mocks.publish.mockResolvedValueOnce({ success: false, error: "Focus card consent changed. Review it and try again." });
    const { result } = renderHook(() => useFocusCard(INPUT));
    await act(async () => { await result.current.enable(); });
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(result.current.enabled).not.toBe(true);
    expect(result.current.error).toMatch(/consent changed/);
  });

  it("discards an older built payload after a newer deletion refresh starts", async () => {
    const oldPayload = deferred<{ focusSeconds7d: number }>();
    mocks.build.mockReturnValueOnce(oldPayload.promise).mockResolvedValueOnce({ focusSeconds7d: 0 });
    const { result } = renderHook(() => useFocusCard(INPUT));
    let old!: Promise<void>, latest!: Promise<void>;
    await act(async () => { old = result.current.refresh(); });
    await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(1));
    await act(async () => { latest = result.current.refresh(); });
    await act(async () => {
      oldPayload.resolve({ focusSeconds7d: 3600 });
      await Promise.all([old, latest]);
    });
    expect(mocks.refresh.mock.calls.map(([payload]) => payload.focusSeconds7d)).toEqual([0]);
    expect(result.current.previewPayload).toEqual({ focusSeconds7d: 0 });
  });

  it("waits for an already submitted old write before posting the deletion total", async () => {
    const release = deferred<void>();
    const committed: number[] = [];
    mocks.build.mockResolvedValueOnce({ focusSeconds7d: 3600 }).mockResolvedValueOnce({ focusSeconds7d: 0 });
    mocks.refresh.mockImplementationOnce(async (payload: { focusSeconds7d: number }) => {
      await release.promise; committed.push(payload.focusSeconds7d); return { success: true };
    }).mockImplementationOnce(async (payload: { focusSeconds7d: number }) => {
      committed.push(payload.focusSeconds7d); return { success: true };
    });
    const { result } = renderHook(() => useFocusCard(INPUT));
    let old!: Promise<void>, latest!: Promise<void>;
    await act(async () => { old = result.current.refresh(); });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    await act(async () => { latest = result.current.refresh(); });
    const submissionsWhileOldPending = mocks.refresh.mock.calls.length;
    await act(async () => { release.resolve(); await Promise.all([old, latest]); });
    expect(submissionsWhileOldPending).toBe(1);
    expect(committed).toEqual([3600, 0]);
  });

  it("reconciles deletion after an earlier explicit enable finishes", async () => {
    const oldPayload = deferred<{ focusSeconds7d: number }>();
    let enabled = false, stored = -1;
    mocks.fetch.mockImplementation(async () => ({ success: true, data: { enabled } }));
    mocks.build.mockReturnValueOnce(oldPayload.promise).mockResolvedValueOnce({ focusSeconds7d: 0 });
    mocks.publish.mockImplementation(async (payload: { focusSeconds7d: number }) => {
      enabled = true; stored = payload.focusSeconds7d; return { success: true };
    });
    mocks.refresh.mockImplementation(async (payload: { focusSeconds7d: number }) => {
      stored = payload.focusSeconds7d; return { success: true };
    });
    const { result } = renderHook(() => useFocusCard(INPUT));
    let enabling!: Promise<boolean>, deletion!: Promise<void>;
    await act(async () => { enabling = result.current.enable(); });
    await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(1));
    await act(async () => { deletion = result.current.refresh(); });
    let enabledSuccessfully = false;
    await act(async () => {
      oldPayload.resolve({ focusSeconds7d: 3600 });
      enabledSuccessfully = await enabling;
      await deletion;
    });
    expect(enabledSuccessfully).toBe(true);
    expect(enabled).toBe(true);
    expect(stored).toBe(0);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("continues the deletion refresh after an earlier request rejects", async () => {
    const release = deferred<void>();
    mocks.build.mockResolvedValueOnce({ focusSeconds7d: 3600 }).mockResolvedValueOnce({ focusSeconds7d: 0 });
    mocks.refresh.mockImplementationOnce(async () => {
      await release.promise; throw new Error("Synthetic earlier authentication failure");
    }).mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useFocusCard(INPUT));
    let old!: Promise<unknown>, latest!: Promise<void>;
    await act(async () => { old = result.current.refresh().catch((error: unknown) => error); });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    await act(async () => { latest = result.current.refresh(); });
    let earlierError: unknown;
    await act(async () => { release.resolve(); earlierError = await old; await latest; });
    expect(earlierError).toBeInstanceOf(Error);
    expect(mocks.refresh.mock.lastCall?.[0]).toEqual({ focusSeconds7d: 0 });
    expect(result.current.error).toBeNull();
  });

  it("coalesces superseded queued refreshes and retains the latest local total", async () => {
    const release = deferred<void>();
    let localTotal = 3600;
    const committed: number[] = [];
    mocks.build.mockImplementation(async () => ({ focusSeconds7d: localTotal }));
    mocks.refresh.mockImplementationOnce(async (payload: { focusSeconds7d: number }) => {
      await release.promise; committed.push(payload.focusSeconds7d); return { success: true };
    }).mockImplementation(async (payload: { focusSeconds7d: number }) => {
      committed.push(payload.focusSeconds7d); return { success: true };
    });
    const { result } = renderHook(() => useFocusCard(INPUT));
    let old!: Promise<void>, middle!: Promise<void>, latest!: Promise<void>;
    await act(async () => { old = result.current.refresh(); });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    await act(async () => { localTotal = 99; middle = result.current.refresh(); });
    await act(async () => { localTotal = 0; latest = result.current.refresh(); });
    await act(async () => { release.resolve(); await Promise.all([old, middle, latest]); });
    expect(committed).toEqual([3600, 0]);
    expect(result.current.previewPayload).toEqual({ focusSeconds7d: 0 });
  });

  it("preserves the assessment gate while a deletion refresh is queued", async () => {
    const release = deferred<void>();
    mocks.refresh.mockImplementationOnce(async () => { await release.promise; return { success: true }; });
    const { result, rerender } = renderHook(({ ready }: { ready: boolean }) =>
      useFocusCard({ ...INPUT, classificationAssessmentReady: ready }), { initialProps: { ready: true } });
    let old!: Promise<void>, latest!: Promise<void>;
    await act(async () => { old = result.current.refresh(); });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    await act(async () => { latest = result.current.refresh(); rerender({ ready: false }); });
    await act(async () => { release.resolve(); await Promise.all([old, latest]); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/classification is paused/i);
  });

  it("keeps explicit disable immediate while an aggregate refresh is waiting", async () => {
    const release = deferred<void>();
    mocks.refresh.mockImplementationOnce(async () => { await release.promise; return { success: true }; });
    const { result } = renderHook(() => useFocusCard(INPUT));
    let old!: Promise<void>;
    await act(async () => { old = result.current.refresh(); });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    try {
      await act(async () => { await result.current.disable(); });
      expect(mocks.disable).toHaveBeenCalledWith(false, undefined, "owner-a");
      expect(result.current.enabled).toBe(false);
    } finally {
      await act(async () => { release.resolve(); await old; });
    }
    expect(result.current.enabled).toBe(false);
  });

  it("keeps deletion reconciliation after an in-flight detail publication", async () => {
    const release = deferred<void>();
    let localTotal = 3600, shareCategoryBreakdown = false;
    const committed: number[] = [];
    mocks.build.mockImplementation(async () => ({ focusSeconds7d: localTotal }));
    mocks.fetch.mockImplementation(async () => ({ success: true, data: { enabled: true,
      detailFlags: { shareCategoryBreakdown, shareHourlyPattern: false } } }));
    mocks.publish.mockImplementation(async (payload: { focusSeconds7d: number }) => {
      await release.promise; shareCategoryBreakdown = true;
      committed.push(payload.focusSeconds7d); return { success: true };
    });
    mocks.refresh.mockImplementation(async (payload: { focusSeconds7d: number }) => {
      committed.push(payload.focusSeconds7d); return { success: true };
    });
    const { result } = renderHook(() => useFocusCard(INPUT));
    await act(async () => { await result.current.refresh(); });
    committed.length = 0; mocks.refresh.mockClear();
    let details!: Promise<void>, deletion!: Promise<void>;
    await act(async () => { details = result.current.setDetailFlag("shareCategoryBreakdown", true); });
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    await act(async () => { localTotal = 0; deletion = result.current.refresh(); });
    const submissionsWhileDetailsPending = mocks.refresh.mock.calls.length;
    await act(async () => { release.resolve(); await Promise.all([details, deletion]); });
    expect(submissionsWhileDetailsPending).toBe(0);
    expect(committed).toEqual([3600, 0]);
    expect(result.current.detailFlags?.shareCategoryBreakdown).toBe(true);
  });

  it("keeps live detail withdrawal immediate while an aggregate write is waiting", async () => {
    const release = deferred<void>();
    mocks.fetch.mockResolvedValue({ success: true, data: { enabled: true,
      detailFlags: { shareCategoryBreakdown: true, shareHourlyPattern: false } } });
    const { result } = renderHook(() => useFocusCard(INPUT));
    await act(async () => { await result.current.refresh(); });
    mocks.publish.mockClear();
    mocks.refresh.mockImplementationOnce(async () => { await release.promise; return { success: true }; });
    let old!: Promise<void>, withdrawal!: Promise<void>;
    await act(async () => { old = result.current.refresh(); });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    await act(async () => { withdrawal = result.current.setDetailFlag("shareCategoryBreakdown", false); });
    const publicationsWhileOldPending = mocks.publish.mock.calls.length;
    await act(async () => { release.resolve(); await Promise.all([old, withdrawal]); });
    expect(publicationsWhileOldPending).toBe(1);
    expect(result.current.detailFlags?.shareCategoryBreakdown).toBe(false);
  });
});
