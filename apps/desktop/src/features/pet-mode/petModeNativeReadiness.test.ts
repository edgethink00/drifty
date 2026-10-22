import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PET_MODE_STARTUP_READY_TIMEOUT_MS,
  PET_MODE_STARTUP_RETRY_DELAYS_MS,
  waitForPetModeStartupRetryReadiness,
  waitForPetModeSyncRetry,
} from "./petModeNativeReadiness";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("native pet startup readiness", () => {
  const unavailable = new Error("Pet Mode window is not available");
  let notify: (event: { payload: unknown }) => void;
  let unlisten: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    unlisten = vi.fn();
    listen.mockImplementation((_event, handler) => {
      notify = handler;
      return Promise.resolve(unlisten);
    });
    invoke.mockResolvedValue({ phase: "pending", revision: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it("uses a ready snapshot after subscribing, without requiring a later event", async () => {
    invoke.mockImplementation(() => {
      expect(listen).toHaveBeenCalledTimes(1);
      return Promise.resolve({ phase: "ready", revision: 1 });
    });
    const status = vi.fn();
    await waitForPetModeStartupRetryReadiness(unavailable, true, new AbortController().signal, status);
    expect(status.mock.calls.map(([value]) => value)).toEqual(["waiting", "ready"]);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("accepts ready before the subscription ACK and cleans up the late listener", async () => {
    const ack = deferred<() => void>();
    listen.mockImplementation((_event, handler) => { notify = handler; return ack.promise; });
    const status = vi.fn();
    const waiting = waitForPetModeStartupRetryReadiness(unavailable, true, new AbortController().signal, status);
    notify({ payload: { phase: "ready", revision: 1 } });
    await waiting;
    ack.resolve(unlisten);
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(status.mock.calls.map(([value]) => value)).toEqual(["waiting", "ready"]);
  });

  it("settles once when a ready event races a pending snapshot reply", async () => {
    const snapshot = deferred<unknown>();
    invoke.mockReturnValue(snapshot.promise);
    const status = vi.fn();
    const waiting = waitForPetModeStartupRetryReadiness(unavailable, true, new AbortController().signal, status);
    await Promise.resolve();
    notify({ payload: { phase: "ready", revision: 1 } });
    await waiting;
    snapshot.resolve({ phase: "pending", revision: 0 });
    await Promise.resolve();
    expect(status.mock.calls.map(([value]) => value)).toEqual(["waiting", "ready"]);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("aborts without waiting for a listener ACK and ignores late ready", async () => {
    const ack = deferred<() => void>();
    listen.mockImplementation((_event, handler) => { notify = handler; return ack.promise; });
    const controller = new AbortController();
    const status = vi.fn();
    const waiting = waitForPetModeStartupRetryReadiness(unavailable, true, controller.signal, status);
    const rejected = expect(waiting).rejects.toThrow("readiness cancelled");
    controller.abort();
    await rejected;
    notify({ payload: { phase: "ready", revision: 1 } });
    ack.resolve(unlisten);
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(status.mock.calls.map(([value]) => value)).toEqual(["waiting", "cancelled"]);
  });

  it.each(["snapshot", "event"])("ends immediately on setup failure from %s", async (source) => {
    if (source === "snapshot") invoke.mockResolvedValue({ phase: "failed", revision: 1 });
    const status = vi.fn();
    const waiting = waitForPetModeStartupRetryReadiness(unavailable, true, new AbortController().signal, status);
    const rejected = expect(waiting).rejects.toThrow("readiness failed");
    await Promise.resolve();
    if (source === "event") notify({ payload: { phase: "failed", revision: 1 } });
    await rejected;
    expect(status.mock.calls.map(([value]) => value)).toEqual(["waiting", "failed"]);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("bounds a hung subscription and removes its late listener without polling", async () => {
    const ack = deferred<() => void>();
    listen.mockReturnValue(ack.promise);
    const status = vi.fn();
    const waiting = waitForPetModeStartupRetryReadiness(unavailable, true, new AbortController().signal, status);
    const rejected = expect(waiting).rejects.toThrow("readiness timed_out");
    await vi.advanceTimersByTimeAsync(PET_MODE_STARTUP_READY_TIMEOUT_MS);
    await rejected;
    ack.resolve(unlisten);
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(status.mock.calls.map(([value]) => value)).toEqual(["waiting", "timed_out"]);
  });

  it("does not introduce readiness waiting for other errors or later manual reveals", async () => {
    const status = vi.fn();
    await waitForPetModeStartupRetryReadiness(new Error("pet_mode::apply did not finish on the native thread"), true, new AbortController().signal, status);
    await waitForPetModeStartupRetryReadiness(unavailable, false, new AbortController().signal, status);
    expect(listen).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });
});

describe("bounded pet sync retry", () => {
  const timeout = new Error("pet_mode::apply_render_geometry did not finish on the native thread");
  const unavailable = new Error("Pet Mode window is not available");
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    listen.mockResolvedValue(vi.fn());
    invoke.mockResolvedValue({ phase: "pending", revision: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it("backs off before each startup retry and stops after the final attempt", async () => {
    for (const [retries, delayMs] of PET_MODE_STARTUP_RETRY_DELAYS_MS.entries()) {
      let settled: boolean | undefined;
      void waitForPetModeSyncRetry(timeout, true, retries, new AbortController().signal, vi.fn())
        .then((value) => { settled = value; });
      await vi.advanceTimersByTimeAsync(delayMs - 1);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    }
    await expect(waitForPetModeSyncRetry(timeout, true, PET_MODE_STARTUP_RETRY_DELAYS_MS.length,
      new AbortController().signal, vi.fn())).resolves.toBe(false);
  });

  it("keeps one immediate retry for an explicit reveal", async () => {
    await expect(waitForPetModeSyncRetry(timeout, false, 0, new AbortController().signal, vi.fn())).resolves.toBe(true);
    await expect(waitForPetModeSyncRetry(timeout, false, 1, new AbortController().signal, vi.fn())).resolves.toBe(false);
  });

  it("cancels a pending backoff without queueing a retry", async () => {
    const controller = new AbortController();
    const waiting = waitForPetModeSyncRetry(timeout, true, 1, controller.signal, vi.fn());
    const rejected = expect(waiting).rejects.toThrow("cancelled");
    controller.abort();
    await rejected;
  });

  it("ends after setup failure but backs off after a readiness timeout", async () => {
    invoke.mockResolvedValueOnce({ phase: "failed", revision: 1 });
    await expect(waitForPetModeSyncRetry(unavailable, true, 0, new AbortController().signal, vi.fn()))
      .rejects.toThrow("readiness failed");
    let settled: boolean | undefined;
    void waitForPetModeSyncRetry(unavailable, true, 0, new AbortController().signal, vi.fn())
      .then((value) => { settled = value; });
    await vi.advanceTimersByTimeAsync(PET_MODE_STARTUP_READY_TIMEOUT_MS);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(PET_MODE_STARTUP_RETRY_DELAYS_MS[0]);
    expect(settled).toBe(true);
  });
});
