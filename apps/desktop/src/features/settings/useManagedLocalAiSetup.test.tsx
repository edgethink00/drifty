// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "./localAiSetup";
import {
  fallbackManagedLocalAiStatus,
  installingManagedLocalAiStatus,
  MANAGED_LOCAL_AI_FALLBACK_CATALOG,
  type ManagedLocalAiStatus,
} from "./managedLocalAiClient";
import { useManagedLocalAiSetup } from "./useManagedLocalAiSetup";

type StatusEventHandler = (event: { readonly payload: unknown }) => void;

const clientMocks = vi.hoisted(() => ({
  getManagedLocalAiStatus: vi.fn(),
  startManagedLocalAi: vi.fn(),
  deleteManagedLocalAiModel: vi.fn(),
  listManagedLocalAiModels: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("./managedLocalAiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./managedLocalAiClient")>();
  return {
    ...actual,
    getManagedLocalAiStatus: clientMocks.getManagedLocalAiStatus,
    startManagedLocalAi: clientMocks.startManagedLocalAi,
    deleteManagedLocalAiModel: clientMocks.deleteManagedLocalAiModel,
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

  it("keeps a newly selected model when old ready events arrive during and after its start", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const old = { ...installingManagedLocalAiStatus("drifty-qwen3-5-4b-default"), state: "running" as const, baseUrl: "http://127.0.0.1:39217/v1", model: "drifty-qwen3.5-4b-local" };
    const next = { ...old, selectedModelId: "drifty-qwen3-5-2b-economy", model: "drifty-qwen3.5-2b-local" };
    clientMocks.getManagedLocalAiStatus.mockResolvedValue(old);
    clientMocks.listManagedLocalAiModels.mockResolvedValue(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
    const start = deferred<ManagedLocalAiStatus>();
    clientMocks.startManagedLocalAi.mockReturnValueOnce(start.promise);
    const { result } = renderHook(() => {
      const [setup, setSetup] = useState<LocalAiSetupState>({ ...DEFAULT_LOCAL_AI_SETUP, managedLocalModelId: old.selectedModelId!, managedLocalBaseUrl: old.baseUrl, managedLocalModel: old.model });
      return { setup, managed: useManagedLocalAiSetup(true, setSetup) };
    });
    await waitFor(() => expect(statusHandler).not.toBeNull());
    let pending!: Promise<void>;
    act(() => { pending = result.current.managed.startModel(next.selectedModelId); });
    expect(result.current.setup.managedLocalModelId).toBe(next.selectedModelId);
    expect(result.current.setup.managedLocalBaseUrl).toBe("");
    act(() => statusHandler?.({ payload: old }));
    expect(result.current.setup.managedLocalModelId).toBe(next.selectedModelId);
    await act(async () => { start.resolve(next); await pending; });
    act(() => statusHandler?.({ payload: old }));
    expect(result.current.setup.managedLocalModel).toBe(next.model);
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

describe("useManagedLocalAiSetup model deletion boundaries", () => {
  const activeId = "drifty-qwen3-5-4b-default";
  const otherId = "drifty-gemma-4-12b-local";
  const readySetup: LocalAiSetupState = {
    ...DEFAULT_LOCAL_AI_SETUP,
    driftyRoute: "local",
    managedLocalModelId: activeId,
    managedLocalBaseUrl: "http://127.0.0.1:39217/v1",
    managedLocalModel: "drifty-qwen3.5-4b-local",
  };
  const installed = (ids: readonly string[]) => ids.map((id) => ({ id, artifactDir: "/synthetic/" + id }));
  const deleted = (ids: readonly string[] = []): ManagedLocalAiStatus => ({
    ...fallbackManagedLocalAiStatus("Synthetic successful deletion"),
    state: "not_installed",
    installedModels: installed(ids),
  });

  beforeEach(() => {
    clientMocks.deleteManagedLocalAiModel.mockReset();
    clientMocks.listManagedLocalAiModels.mockResolvedValue(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
    clientMocks.getManagedLocalAiStatus.mockResolvedValue({
      ...installingManagedLocalAiStatus(activeId, installed([activeId, otherId])),
      state: "running", baseUrl: readySetup.managedLocalBaseUrl, model: readySetup.managedLocalModel,
    });
  });

  async function renderReady(initialSetup = readySetup) {
    const hook = renderHook(() => {
      const [setup, setSetup] = useState(initialSetup);
      const managed = useManagedLocalAiSetup(true, setSetup);
      return { setup, setSetup, managed };
    });
    await waitFor(() => expect(hook.result.current.managed.status?.state).toBe("running"));
    return hook;
  }

  it("keeps the active endpoint after deleting a different installed model", async () => {
    clientMocks.deleteManagedLocalAiModel.mockResolvedValue(deleted([activeId]));
    const { result } = await renderReady();
    await act(async () => { await result.current.managed.deleteModel(otherId); });
    expect(clientMocks.deleteManagedLocalAiModel).toHaveBeenCalledWith(otherId);
    expect(result.current.setup).toEqual(readySetup);
  });

  it("does not interpret a busy native install response as completed deletion", async () => {
    clientMocks.deleteManagedLocalAiModel.mockResolvedValue(
      installingManagedLocalAiStatus(otherId, installed([activeId])),
    );
    const { result } = await renderReady();
    await act(async () => { await result.current.managed.deleteModel(activeId); });
    expect(result.current.managed.status?.state).toBe("installing");
    expect(result.current.setup).toEqual(readySetup);
  });

  it("preserves the setup when native deletion rejects", async () => {
    clientMocks.deleteManagedLocalAiModel.mockRejectedValue(new Error("Synthetic deletion denied"));
    const { result } = await renderReady();
    await act(async () => { await result.current.managed.deleteModel(activeId); });
    expect(result.current.managed.status?.state).toBe("error");
    expect(result.current.setup).toEqual(readySetup);
  });

  it("preserves a newer selected model while the previous deletion is pending", async () => {
    const deletion = deferred<ManagedLocalAiStatus>();
    clientMocks.deleteManagedLocalAiModel.mockReturnValue(deletion.promise);
    const { result } = await renderReady();
    let pending!: Promise<void>;
    act(() => { pending = result.current.managed.deleteModel(activeId); });
    const newer = { ...readySetup, managedLocalModelId: otherId, managedLocalModel: "drifty-gemma4-12b-local" };
    act(() => { result.current.setSetup(newer); });
    await act(async () => { deletion.resolve(deleted([otherId])); await pending; });
    expect(result.current.setup).toEqual(newer);
  });

  it("clears deleted runtime details without changing the chosen provider or route", async () => {
    clientMocks.deleteManagedLocalAiModel.mockResolvedValue(deleted());
    const setup = { ...readySetup, provider: "self_hosted" as const,
      selfHostedBaseUrl: "http://127.0.0.1:11434/v1", selfHostedModel: "synthetic-other-model" };
    const { result } = await renderReady(setup);
    await act(async () => { await result.current.managed.deleteModel(activeId); });
    expect(result.current.setup).toEqual({ ...setup, managedLocalBaseUrl: "", managedLocalModel: "" });
  });
});
