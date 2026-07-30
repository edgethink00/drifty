// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installingManagedLocalAiStatus } from "./managedLocalAiClient";
import { useManagedLocalAiStatusObserver } from "./useManagedLocalAiStatusObserver";

type StatusEventHandler = (event: { readonly payload: unknown }) => void;
type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

const mocks = vi.hoisted(() => ({
  getManagedLocalAiStatus: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("./managedLocalAiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./managedLocalAiClient")>();
  return { ...actual, getManagedLocalAiStatus: mocks.getManagedLocalAiStatus };
});

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

describe("useManagedLocalAiStatusObserver", () => {
  let statusHandler: StatusEventHandler | null = null;

  beforeEach(() => {
    statusHandler = null;
    mocks.getManagedLocalAiStatus.mockReset();
    mocks.listen.mockReset();
    mocks.unlisten.mockReset();
    mocks.listen.mockImplementation((_eventName: string, handler: StatusEventHandler) => {
      statusHandler = handler;
      return Promise.resolve(mocks.unlisten);
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.useRealTimers();
  });

  it("reads the current download and follows native progress events", async () => {
    mocks.getManagedLocalAiStatus.mockResolvedValue({
      ...installingManagedLocalAiStatus("drifty-qwen3-5-4b-default"),
      progress: { percent: 42, downloadedBytes: 1_176_000_000, totalBytes: 2_800_000_000 },
    });
    const { result, unmount } = renderHook(() => useManagedLocalAiStatusObserver(true));

    await waitFor(() => expect(result.current?.progress?.percent).toBe(42));
    expect(mocks.listen).toHaveBeenCalledWith("managed-ai-status", expect.any(Function));
    await waitFor(() => expect(statusHandler).not.toBeNull());

    act(() => {
      statusHandler?.({
        payload: {
          ...installingManagedLocalAiStatus("drifty-qwen3-5-4b-default"),
          progress: { percent: 72, downloadedBytes: 2_016_000_000, totalBytes: 2_800_000_000 },
        },
      });
    });
    expect(result.current?.progress?.percent).toBe(72);

    unmount();
    await waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(1));
  });

  it("stays idle outside the native runtime", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    const { result } = renderHook(() => useManagedLocalAiStatusObserver(true));
    await act(async () => Promise.resolve());
    expect(result.current).toBeNull();
    expect(mocks.getManagedLocalAiStatus).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it("does not let a stale poll restore installing after a completion event", async () => {
    const installing = {
      ...installingManagedLocalAiStatus("drifty-qwen3-5-4b-default"),
      progress: { percent: 42, downloadedBytes: 1_176_000_000, totalBytes: 2_800_000_000 },
    };
    const installed = {
      ...installing,
      state: "installed" as const,
      progress: null,
      message: "Managed local model downloaded.",
    };
    const stalePoll = deferred<typeof installing>();
    mocks.getManagedLocalAiStatus
      .mockResolvedValueOnce(installing)
      .mockReturnValueOnce(stalePoll.promise);

    const { result } = renderHook(() => useManagedLocalAiStatusObserver(true));
    await waitFor(() => expect(result.current?.progress?.percent).toBe(42));

    await waitFor(() => expect(mocks.getManagedLocalAiStatus).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    act(() => statusHandler?.({ payload: installed }));
    expect(result.current?.state).toBe("installed");

    await act(async () => stalePoll.resolve({ ...installing, progress: { ...installing.progress, percent: 41 } }));
    expect(result.current?.state).toBe("installed");
  });

  it("ignores an initial status response after the observer is disabled", async () => {
    const initialStatus = deferred<ReturnType<typeof installingManagedLocalAiStatus>>();
    mocks.getManagedLocalAiStatus.mockReturnValueOnce(initialStatus.promise);
    const { result, rerender } = renderHook(
      ({ enabled }) => useManagedLocalAiStatusObserver(enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(mocks.getManagedLocalAiStatus).toHaveBeenCalledTimes(1));

    rerender({ enabled: false });
    expect(result.current).toBeNull();
    await act(async () => initialStatus.resolve(installingManagedLocalAiStatus("drifty-qwen3-5-4b-default")));
    expect(result.current).toBeNull();
  });
});

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
