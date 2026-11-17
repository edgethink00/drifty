// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountStatsPublisher } from "./useAccountStatsPublisher";

const mocks = vi.hoisted(() => ({
  buildPayload: vi.fn(),
  publish: vi.fn(),
  recordAttempt: vi.fn(),
}));

vi.mock("../../lib/api/previewData", () => ({
  shouldUsePreviewData: () => false,
}));

vi.mock("./accountStatsPayload", () => ({
  buildAccountStatsPayloadFromTracker: mocks.buildPayload,
}));

vi.mock("./accountStatsPublishState", () => ({
  buildAccountStatsPayloadKey: () => "payload-key",
  findAccountStatsPublishRecord: () => null,
  readAccountStatsPublishRecords: () => [],
  recordAccountStatsPublishAttempt: mocks.recordAttempt,
  shouldPublishAccountStats: () => ({ shouldPublish: true, reason: "changed" }),
}));

vi.mock("./accountStatsService", () => ({
  publishAccountStats: mocks.publish,
}));

describe("useAccountStatsPublisher assessment gate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.publish.mockResolvedValue({ success: true, error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("preserves the last published data and state after a tracker limit failure", async () => {
    mocks.buildPayload.mockRejectedValueOnce(new Error("tracker_timeline_too_large"));
    renderHook(() => useAccountStatsPublisher({
      active: true, userScopeKey: "qa-owner", startOfDayMinutes: 0, includeAiClassifications: true,
    }));
    await waitFor(() => expect(mocks.buildPayload).toHaveBeenCalledOnce());
    await act(async () => { await Promise.resolve(); });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.recordAttempt).not.toHaveBeenCalled();
  });

  it("abandons an in-flight payload when the publisher is deactivated", async () => {
    let resolvePayload: ((payload: { windowEndDay: string }) => void) | null = null;
    mocks.buildPayload.mockReturnValueOnce(new Promise((resolve) => {
      resolvePayload = resolve;
    }));
    const { rerender } = renderHook(
      (props: { active: boolean }) => useAccountStatsPublisher({
        active: props.active,
        userScopeKey: "user-1",
        startOfDayMinutes: 0,
        includeAiClassifications: true,
      }),
      { initialProps: { active: true } },
    );

    await waitFor(() => expect(mocks.buildPayload).toHaveBeenCalledOnce());
    rerender({ active: false });
    await act(async () => {
      resolvePayload?.({ windowEndDay: "2026-09-04" });
      await Promise.resolve();
    });

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.recordAttempt).not.toHaveBeenCalled();
  });

  it("rebuilds after reactivation without reusing the previous in-flight payload", async () => {
    let resolvePayload: ((payload: { windowEndDay: string }) => void) | null = null;
    mocks.buildPayload.mockReturnValueOnce(new Promise((resolve) => {
      resolvePayload = resolve;
    }));
    const freshPayload = { windowEndDay: "fresh-after-reactivation" };
    mocks.buildPayload.mockResolvedValueOnce(freshPayload);
    const { rerender } = renderHook(
      (props: { active: boolean }) => useAccountStatsPublisher({
        active: props.active,
        userScopeKey: "user-1",
        startOfDayMinutes: 0,
        includeAiClassifications: true,
      }),
      { initialProps: { active: true } },
    );

    await waitFor(() => expect(mocks.buildPayload).toHaveBeenCalledOnce());
    rerender({ active: false });
    rerender({ active: true });
    await act(async () => {
      resolvePayload?.({ windowEndDay: "2026-09-04" });
      await Promise.resolve();
    });

    expect(mocks.buildPayload).toHaveBeenCalledTimes(2);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(freshPayload, undefined, { expectedUserId: "user-1" });
    expect(mocks.recordAttempt).toHaveBeenCalledTimes(1);
  });

  it("does not publish an in-flight payload after unmount", async () => {
    let resolvePayload: ((payload: { windowEndDay: string }) => void) | null = null;
    mocks.buildPayload.mockReturnValueOnce(new Promise((resolve) => {
      resolvePayload = resolve;
    }));
    const { unmount } = renderHook(() => useAccountStatsPublisher({
      active: true,
      userScopeKey: "user-1",
      startOfDayMinutes: 0,
      includeAiClassifications: true,
    }));

    await waitFor(() => expect(mocks.buildPayload).toHaveBeenCalledOnce());
    unmount();
    await act(async () => {
      resolvePayload?.({ windowEndDay: "2026-09-04" });
      await Promise.resolve();
    });

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.recordAttempt).not.toHaveBeenCalled();
  });

  it("starts the new account while the previous account's build is still pending", async () => {
    let resolveA!: (payload: unknown) => void;
    mocks.buildPayload.mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve; }))
      .mockResolvedValue({ windowEndDay: "fresh-b" });
    const { rerender } = renderHook(
      (props: { userScopeKey: string }) => useAccountStatsPublisher({
        ...props, active: true, startOfDayMinutes: 0, includeAiClassifications: true,
      }),
      { initialProps: { userScopeKey: "account-a" } },
    );
    await waitFor(() => expect(mocks.buildPayload).toHaveBeenCalledTimes(1));
    rerender({ userScopeKey: "account-b" });
    await waitFor(() => expect(mocks.buildPayload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ userScopeKey: "account-b" })));
    await act(async () => { resolveA({ windowEndDay: "stale-a" }); });
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledWith({ windowEndDay: "fresh-b" }, undefined, { expectedUserId: "account-b" });
    expect(mocks.recordAttempt).toHaveBeenCalledTimes(1);
  });

  it("does not record a publish result after its account is no longer active", async () => {
    let resolvePublishA!: (result: { success: boolean; error: null }) => void;
    mocks.buildPayload.mockResolvedValue({ windowEndDay: "synthetic-day" });
    mocks.publish.mockReturnValueOnce(new Promise((resolve) => { resolvePublishA = resolve; }));
    const { rerender } = renderHook(
      (props: { active: boolean }) => useAccountStatsPublisher({
        ...props, userScopeKey: "account-a", startOfDayMinutes: 0, includeAiClassifications: true,
      }),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    rerender({ active: false });
    await act(async () => { resolvePublishA({ success: true, error: null }); });
    expect(mocks.recordAttempt).not.toHaveBeenCalled();
  });

  it("does not release the new account's in-flight slot when the old build completes", async () => {
    let resolveA!: (payload: unknown) => void;
    let resolveB!: (payload: unknown) => void;
    mocks.buildPayload
      .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve; }));
    const { rerender } = renderHook(
      (props: { userScopeKey: string }) => useAccountStatsPublisher({
        ...props, active: true, startOfDayMinutes: 0, includeAiClassifications: true,
      }),
      { initialProps: { userScopeKey: "account-a" } },
    );
    await waitFor(() => expect(mocks.buildPayload).toHaveBeenCalledTimes(1));
    rerender({ userScopeKey: "account-b" });
    await waitFor(() => expect(mocks.buildPayload).toHaveBeenCalledTimes(2));
    await act(async () => { resolveA({ windowEndDay: "stale-a" }); });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(mocks.buildPayload).toHaveBeenCalledTimes(2);
    await act(async () => { resolveB({ windowEndDay: "fresh-b" }); });
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("ignores an in-flight publish result after unmount", async () => {
    let resolvePublish!: (result: { success: boolean; error: null }) => void;
    mocks.buildPayload.mockResolvedValue({ windowEndDay: "synthetic-day" });
    mocks.publish.mockReturnValueOnce(new Promise((resolve) => { resolvePublish = resolve; }));
    const { unmount } = renderHook(() => useAccountStatsPublisher({
      active: true, userScopeKey: "account-a", startOfDayMinutes: 0, includeAiClassifications: true,
    }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => { resolvePublish({ success: true, error: null }); });
    expect(mocks.recordAttempt).not.toHaveBeenCalled();
  });
  it("does not back off the old account when the authenticated owner has already changed", async () => {
    mocks.buildPayload.mockResolvedValue({ windowEndDay: "synthetic-day" });
    mocks.publish.mockResolvedValue({
      success: false, error: "The signed-in account changed before stats publication", accountChanged: true,
    });
    renderHook(() => useAccountStatsPublisher({
      active: true, userScopeKey: "account-a", startOfDayMinutes: 0, includeAiClassifications: true,
    }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    expect(mocks.recordAttempt).not.toHaveBeenCalled();
  });
});
