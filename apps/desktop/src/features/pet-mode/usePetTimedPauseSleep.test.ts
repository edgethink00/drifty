// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY } from "../companion/automaticCloseOverride";
import { usePetTimedPauseSleep } from "./usePetTimedPauseSleep";
import type { PetQuickControlsStatePayload } from "./petModeBridge";

const bridge = vi.hoisted(() => ({
  getNativePetQuickControlsState: vi.fn().mockResolvedValue(null),
  listenToNativePetQuickControlsState: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("./petModeBridge", () => bridge);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  bridge.getNativePetQuickControlsState.mockReset().mockResolvedValue(null);
  bridge.listenToNativePetQuickControlsState.mockReset().mockResolvedValue(vi.fn());
  localStorage.clear();
});

function nativeState(until: number | null): PetQuickControlsStatePayload {
  return { automaticCloseEnabled: until === null, automaticCloseSavedEnabled: true,
    automaticCloseOverride: until === null ? null : { enabled: false, kind: "15", endsAtMs: until },
    language: "en", theme: "light" };
}

it("uses native session state when persistence failed, including on remount", async () => {
  const until = seedPause();
  localStorage.clear();
  bridge.getNativePetQuickControlsState.mockResolvedValue(nativeState(until));
  const first = renderHook(usePetTimedPauseSleep);
  await act(async () => undefined);
  expect(first.result.current).toBe(until);
  act(() => window.dispatchEvent(new Event("focus")));
  expect(first.result.current).toBe(until);
  first.unmount();
  const second = renderHook(usePetTimedPauseSleep);
  await act(async () => undefined);
  expect(second.result.current).toBe(until);
  act(() => vi.advanceTimersByTime(900_000));
  expect(second.result.current).toBeNull();
});

it("keeps the latest native event over a stale initial read and stale storage", async () => {
  const until = seedPause();
  let receive!: (state: PetQuickControlsStatePayload) => void;
  let completeRead!: (state: PetQuickControlsStatePayload) => void;
  bridge.listenToNativePetQuickControlsState.mockImplementation(async (handler) => { receive = handler; return vi.fn(); });
  bridge.getNativePetQuickControlsState.mockImplementation(() => new Promise((resolve) => { completeRead = resolve; }));
  const { result } = renderHook(usePetTimedPauseSleep);
  await act(async () => undefined);
  await act(async () => {
    receive(nativeState(null));
    completeRead(nativeState(until));
  });
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY })));
  expect(result.current).toBeNull();
  await act(async () => receive(nativeState(until + 900_000)));
  expect(result.current).toBe(until + 900_000);
});

it("unsubscribes when the native listener finishes after unmount", async () => {
  seedPause();
  let completeListen!: (stop: () => void) => void;
  bridge.listenToNativePetQuickControlsState.mockImplementationOnce(() => new Promise((resolve) => { completeListen = resolve; }));
  const stop = vi.fn();
  const { unmount } = renderHook(usePetTimedPauseSleep);
  unmount();
  await act(async () => completeListen(stop));
  expect(stop).toHaveBeenCalledOnce();
  expect(bridge.getNativePetQuickControlsState).not.toHaveBeenCalled();
});

function seedPause() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
  const until = Date.now() + 900_000;
  localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify({
    enabled: false, kind: "15", startedAtMs: Date.now(), endsAtMs: until,
  }));
  return until;
}

it("rearms a deadline if the system clock moves backwards before the timer fires", () => {
  const until = seedPause();
  const { result } = renderHook(usePetTimedPauseSleep);
  act(() => {
    vi.setSystemTime(Date.now() - 60_000);
    vi.advanceTimersByTime(900_000);
  });
  expect(result.current).toBe(until);
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current).toBeNull();
});

it("expires after a clock jump when the webview becomes visible", () => {
  const until = seedPause();
  const { result } = renderHook(usePetTimedPauseSleep);
  act(() => {
    vi.setSystemTime(until + 1);
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(result.current).toBeNull();
});

it.each([["60", 3_600_000], ["today", 86_400_000]] as const)(
  "keeps the persisted %s pause until its exact deadline",
  (kind, duration) => {
    seedPause(); // Midnight UTC: the today fixture ends at the next midnight.
    const until = Date.now() + duration;
    localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify({
      enabled: false, kind, startedAtMs: Date.now(), endsAtMs: until,
    }));
    const { result } = renderHook(usePetTimedPauseSleep);
    act(() => vi.advanceTimersByTime(duration - 1));
    expect(result.current).toBe(until);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  },
);

it("handles storage clear and releases its timer and listeners on unmount", () => {
  seedPause();
  const { result, unmount } = renderHook(usePetTimedPauseSleep);
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(result.current).toBeNull();
  const reads = vi.spyOn(Storage.prototype, "getItem");
  unmount();
  reads.mockClear();
  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(900_000);
  });
  expect(reads).not.toHaveBeenCalled();
});
