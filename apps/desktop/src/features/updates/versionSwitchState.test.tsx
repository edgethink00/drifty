// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { pauseUpdatesForVersionTest, resumeUpdatesAfterVersionTest } from "./versionSwitchState";
import { useAutomaticUpdateScheduler, UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY, WINDOWS_BETA_NEXT_AUTOMATIC_CHECK_STORAGE_KEY } from "./useAutomaticUpdateScheduler";
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
it("reschedules a pending check to the test deadline and does not overwrite it with an in-flight result", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const check = vi.fn(() => new Promise<void>(r => { finish = r; }));
  renderHook(() => useAutomaticUpdateScheduler({ enabled: true, checkForUpdates: check }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(check).toHaveBeenCalledTimes(1);
  act(() => pauseUpdatesForVersionTest());
  const deadline = localStorage.getItem(UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY);
  await act(async () => { finish(); await Promise.resolve(); });
  expect(localStorage.getItem(UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY)).toBe(deadline);
  await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); });
  expect(check).toHaveBeenCalledTimes(1);
});

it("keeps the persisted pause across remounts and resumes at the seven-day deadline", async () => {
  vi.useFakeTimers();
  act(() => pauseUpdatesForVersionTest());
  const deadline = Number(localStorage.getItem(UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY));
  const check = vi.fn(async () => ({ kind: "none" as const }));
  const first = renderHook(() => useAutomaticUpdateScheduler({ enabled: true, checkForUpdates: check }));
  await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); });
  first.unmount();
  renderHook(() => useAutomaticUpdateScheduler({ enabled: true, checkForUpdates: check }));
  await act(async () => { await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1); });
  expect(check).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(check).toHaveBeenCalledTimes(1);
  expect(Number(localStorage.getItem(UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY))).toBe(deadline + 24 * 60 * 60 * 1000);
});

it("resumes checks promptly when requested without re-enabling background installation", async () => {
  vi.useFakeTimers();
  act(() => pauseUpdatesForVersionTest());
  const check = vi.fn(async () => ({ kind: "none" as const }));
  renderHook(() => useAutomaticUpdateScheduler({ enabled: true, checkForUpdates: check }));
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(check).not.toHaveBeenCalled();
  act(() => resumeUpdatesAfterVersionTest());
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(check).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("drifty.updates.backgroundApply.v2")).toBe("0");
});

it("keeps a platform beta schedule isolated while still honoring a version-test pause", async () => {
  vi.useFakeTimers();
  const check = vi.fn(async () => ({ kind: "none" as const }));
  renderHook(() => useAutomaticUpdateScheduler({
    enabled: true,
    checkForUpdates: check,
    storageKey: WINDOWS_BETA_NEXT_AUTOMATIC_CHECK_STORAGE_KEY,
  }));

  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(check).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(WINDOWS_BETA_NEXT_AUTOMATIC_CHECK_STORAGE_KEY)).not.toBeNull();
  expect(localStorage.getItem(UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY)).toBeNull();

  act(() => pauseUpdatesForVersionTest());
  await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); });
  expect(check).toHaveBeenCalledTimes(1);
});
