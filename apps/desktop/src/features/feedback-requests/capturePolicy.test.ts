// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setCapturePolicy } = vi.hoisted(() => ({ setCapturePolicy: vi.fn() }));
vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: { setCapturePolicy } }));

import {
  CAPTURE_POLICY_RETRY_MS,
  capturePolicyPayload,
  normalizeCapturePolicy,
  resetCapturePolicyForTests,
  updateCapturePolicy,
  useCapturePolicySync,
} from "./capturePolicy";

describe("capture policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    resetCapturePolicyForTests();
    setCapturePolicy.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves confirmed private windows out and records every hour by default", () => {
    expect(capturePolicyPayload(normalizeCapturePolicy(null))).toEqual({ privateWindows: "skip", recordingSchedule: null });
  });

  it("sends recording hours as a record-within schedule, and nothing when no day is picked", () => {
    const hours = { enabled: true, days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 };
    expect(capturePolicyPayload(normalizeCapturePolicy({ recordingHours: hours })).recordingSchedule)
      .toEqual({ enabled: true, mode: "record-within", days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 });
    expect(capturePolicyPayload(normalizeCapturePolicy({ recordingHours: { ...hours, days: [] } })).recordingSchedule).toBeNull();
  });

  it("retries a failed send so the tracker does not wait for the next launch", async () => {
    setCapturePolicy.mockRejectedValueOnce(new Error("tracker busy")).mockResolvedValue(undefined);
    renderHook(() => useCapturePolicySync());
    await act(async () => { await Promise.resolve(); });
    expect(setCapturePolicy).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(CAPTURE_POLICY_RETRY_MS); await Promise.resolve(); });
    expect(setCapturePolicy).toHaveBeenCalledTimes(2);
    act(() => updateCapturePolicy({ privateWindows: "record" }));
    await act(async () => { await Promise.resolve(); });
    expect(setCapturePolicy).toHaveBeenLastCalledWith({ privateWindows: "record", recordingSchedule: null });
  });
});
