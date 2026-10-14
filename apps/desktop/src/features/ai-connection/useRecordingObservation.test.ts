// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRecordingObservation } from "./useRecordingObservation";
import { RECORDING_STATUS_MAX_AGE_MS } from "./recordingHealth";

const status = { running: true, accessibilityGranted: true, trackerMode: "tracking" };
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("recording observation freshness", () => {
  it("expires full-status evidence even while capture replies continue", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRecordingObservation(null));
    act(() => { result.current.acceptStatus(result.current.beginRequest(), status); });
    expect(result.current.statusFresh).toBe(true);
    act(() => { vi.advanceTimersByTime(60_000); result.current.acceptCapture(result.current.beginRequest(), true); });
    act(() => vi.advanceTimersByTime(RECORDING_STATUS_MAX_AGE_MS - 60_000));
    expect(result.current.statusFresh).toBe(false);
    expect(result.current.captureFresh).toBe(true);
  });
  it("invalidates failed capture and recovers on a later successful check", () => {
    const { result } = renderHook(() => useRecordingObservation(null));
    act(() => { result.current.acceptStatus(result.current.beginRequest(), status); });
    act(() => { result.current.acceptCapture(result.current.beginRequest(), false); });
    expect(result.current.captureFresh).toBe(false);
    act(() => { result.current.acceptStatus(result.current.beginRequest(), status); });
    expect(result.current.captureFresh).toBe(true);
    act(() => { result.current.acceptStatus(result.current.beginRequest(), { ...status, trackerMode: "unavailable" }); });
    expect(result.current.statusFresh).toBe(false);
  });
  it("rejects late successful or failed replies after newer evidence", () => {
    const { result } = renderHook(() => useRecordingObservation(null));
    const older = result.current.beginRequest();
    const newer = result.current.beginRequest();
    act(() => { result.current.acceptStatus(newer, status); });
    act(() => { expect(result.current.acceptCapture(older, false)).toBe(false); });
    expect(result.current.captureFresh).toBe(true);
    const failed = result.current.beginRequest();
    act(() => { result.current.acceptCapture(failed, false); });
    act(() => { expect(result.current.acceptStatus(newer, status)).toBe(true); });
    expect(result.current.captureFresh).toBe(false);
  });
  it("accepts a full permission check after a newer capture reply without erasing capture failure", () => {
    const { result } = renderHook(() => useRecordingObservation(null));
    const full = result.current.beginRequest();
    const tail = result.current.beginRequest();
    act(() => { result.current.acceptCapture(tail, false); });
    act(() => { expect(result.current.acceptStatus(full, status)).toBe(true); });
    expect(result.current.statusFresh).toBe(true);
    expect(result.current.captureFresh).toBe(false);
  });

});
