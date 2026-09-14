// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalAiSetupState } from "./localAiSetup";
import {
  fallbackManagedLocalAiStatus,
  installingManagedLocalAiStatus,
  MANAGED_LOCAL_AI_FALLBACK_CATALOG,
} from "./managedLocalAiClient";
import { useManagedLocalAiSetup } from "./useManagedLocalAiSetup";

type StatusEventHandler = (event: { readonly payload: unknown }) => void;

const clientMocks = vi.hoisted(() => ({
  getManagedLocalAiStatus: vi.fn(),
  listManagedLocalAiModels: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("./managedLocalAiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./managedLocalAiClient")>();
  return {
    ...actual,
    getManagedLocalAiStatus: clientMocks.getManagedLocalAiStatus,
    listManagedLocalAiModels: clientMocks.listManagedLocalAiModels,
  };
});

vi.mock("@tauri-apps/api/event", () => ({ listen: clientMocks.listen }));

const setLocalAiSetup = vi.fn<Dispatch<SetStateAction<LocalAiSetupState>>>();

describe("useManagedLocalAiSetup background failures", () => {
  let statusHandler: StatusEventHandler | null = null;

  beforeEach(() => {
    statusHandler = null;
    clientMocks.getManagedLocalAiStatus.mockReset();
    clientMocks.listManagedLocalAiModels.mockReset();
    clientMocks.listen.mockReset();
    clientMocks.unlisten.mockReset();
    clientMocks.listen.mockImplementation((_eventName: string, handler: StatusEventHandler) => {
      statusHandler = handler;
      return Promise.resolve(clientMocks.unlisten);
    });
    setLocalAiSetup.mockClear();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.useRealTimers();
  });

  it("contains a string rejection from the detached catalog refresh", async () => {
    clientMocks.listManagedLocalAiModels.mockRejectedValue("catalog unavailable");
    clientMocks.getManagedLocalAiStatus.mockResolvedValue(fallbackManagedLocalAiStatus("status unavailable"));

    const { result } = renderHook(() => useManagedLocalAiSetup(true, setLocalAiSetup));

    await waitFor(() => expect(clientMocks.listManagedLocalAiModels).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.catalog).toEqual(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
  });

  it("contains a string rejection from a detached status poll", async () => {
    vi.useFakeTimers();
    clientMocks.listManagedLocalAiModels.mockResolvedValue(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
    clientMocks.getManagedLocalAiStatus
      .mockResolvedValueOnce(installingManagedLocalAiStatus("drifty-qwen3-5-4b-default"))
      .mockRejectedValueOnce("status poll unavailable")
      .mockResolvedValueOnce({
        ...installingManagedLocalAiStatus("drifty-qwen3-5-4b-default"),
        state: "running",
        baseUrl: "http://127.0.0.1:11434",
        model: "drifty-qwen3-5-4b-default",
        message: "Managed local AI is ready.",
      });

    const { result } = renderHook(() => useManagedLocalAiSetup(true, setLocalAiSetup));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status?.state).toBe("installing");

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientMocks.getManagedLocalAiStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.state).toBe("installing");

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientMocks.getManagedLocalAiStatus).toHaveBeenCalledTimes(3);
    expect(result.current.status?.state).toBe("running");
  });

  it("does not let an initial status read overwrite a newer native event", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const initialStatus = deferred<ReturnType<typeof fallbackManagedLocalAiStatus>>();
    clientMocks.listManagedLocalAiModels.mockResolvedValue(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
    clientMocks.getManagedLocalAiStatus.mockReturnValue(initialStatus.promise);
    const running = {
      ...installingManagedLocalAiStatus("drifty-qwen3-5-2b-economy"),
      state: "running" as const,
      baseUrl: "http://127.0.0.1:39217/v1",
      model: "drifty-qwen3.5-2b-local",
      message: "Managed local AI runtime is running.",
    };

    const { result } = renderHook(() => useManagedLocalAiSetup(true, setLocalAiSetup));
    await waitFor(() => expect(statusHandler).not.toBeNull());

    act(() => statusHandler?.({ payload: running }));
    expect(result.current.status?.state).toBe("running");

    await act(async () => {
      initialStatus.resolve(fallbackManagedLocalAiStatus("Stale start failure."));
      await initialStatus.promise;
    });
    expect(result.current.status?.state).toBe("running");
  });
});

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
