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
    vi.clearAllMocks();
    mocks.publish.mockResolvedValue({ success: true, error: null });
  });

  afterEach(() => {
    cleanup();
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

  it("does not reuse a payload across a deactivate-reactivate cycle", async () => {
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
    rerender({ active: true });
    await act(async () => {
      resolvePayload?.({ windowEndDay: "2026-09-04" });
      await Promise.resolve();
    });

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.recordAttempt).not.toHaveBeenCalled();
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
});
