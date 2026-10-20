// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "./localAiSetup";
import { useManagedLocalAiSetup } from "./useManagedLocalAiSetup";
import { installingManagedLocalAiStatus, type ManagedLocalAiStatus } from "./managedLocalAiClient";

const mocks = vi.hoisted(() => ({ status: vi.fn(), start: vi.fn(), install: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./managedLocalAiClient", async (load) => ({
  ...await load<typeof import("./managedLocalAiClient")>(),
  getManagedLocalAiStatus: mocks.status,
  startManagedLocalAi: mocks.start,
  installManagedLocalAiModel: mocks.install,
  listManagedLocalAiModels: async () => [],
}));

const oldId = "drifty-qwen3-5-4b-default";
const nextId = "drifty-qwen3-5-2b-economy";
const old = {
  ...installingManagedLocalAiStatus(oldId), state: "running" as const,
  baseUrl: "http://127.0.0.1:39217/v1", model: "drifty-qwen3.5-4b-local",
};
const next = { ...old, selectedModelId: nextId, model: "drifty-qwen3.5-2b-local" };

beforeEach(() => {
  mocks.status.mockReset().mockResolvedValue(old);
  mocks.start.mockReset();
  mocks.install.mockReset();
});
afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function readyHook() {
  const hook = renderHook(() => {
    const [setup, setSetup] = useState<LocalAiSetupState>({
      ...DEFAULT_LOCAL_AI_SETUP, driftyRoute: "local", managedLocalModelId: oldId,
      managedLocalBaseUrl: old.baseUrl, managedLocalModel: old.model,
    });
    return { setup, setSetup, managed: useManagedLocalAiSetup(true, setSetup) };
  });
  await waitFor(() => expect(hook.result.current.managed.status?.state).toBe("running"));
  return hook;
}

it("preserves a newer Cloud route when an earlier Local start completes", async () => {
  const start = deferred<ManagedLocalAiStatus>();
  mocks.start.mockReturnValue(start.promise);
  const { result } = await readyHook();
  let pending!: Promise<void>;
  act(() => { pending = result.current.managed.startModel(nextId); });
  act(() => { result.current.setSetup(current => ({ ...current, driftyRoute: "cloud" })); });
  await act(async () => { start.resolve(next); await pending; });
  expect(result.current.setup.driftyRoute).toBe("cloud");
});

it("does not let a start response for a different model replace the selected id", async () => {
  mocks.start.mockResolvedValue(old);
  const { result } = await readyHook();
  await act(async () => { await result.current.managed.startModel(nextId); });
  expect(result.current.setup.managedLocalModelId).toBe(nextId);
});

it("keeps the working model after downloading another model fails before activation", async () => {
  mocks.install.mockResolvedValue({
    ...installingManagedLocalAiStatus(nextId), state: "error", errorKind: "insufficient_storage",
    baseUrl: null, model: null, message: "Not enough disk space",
  });
  const { result } = await readyHook();
  await act(async () => { await result.current.managed.installModel(nextId); });
  expect(result.current.setup).toMatchObject({ managedLocalModelId: oldId, managedLocalBaseUrl: old.baseUrl, managedLocalModel: old.model });
});

it("downloads another model without replacing the current model on success", async () => {
  mocks.install.mockResolvedValue({ ...next, state: "installed" });
  const { result } = await readyHook();
  await act(async () => { await result.current.managed.installModel(nextId); });
  expect(result.current.setup).toMatchObject({ managedLocalModelId: oldId, managedLocalBaseUrl: old.baseUrl, managedLocalModel: old.model });
});

it("selects an onboarding download immediately and attaches its completed endpoint", async () => {
  const install = deferred<ManagedLocalAiStatus>();
  mocks.install.mockReturnValue(install.promise);
  const { result } = renderHook(() => {
    const [setup, setSetup] = useState<LocalAiSetupState>({ ...DEFAULT_LOCAL_AI_SETUP, driftyRoute: "cloud" });
    return { setup, managed: useManagedLocalAiSetup(true, setSetup, true) };
  });
  await waitFor(() => expect(result.current.managed.status?.state).toBe("running"));
  let pending!: Promise<void>;
  act(() => { pending = result.current.managed.installModel(nextId); });
  expect(result.current.setup).toMatchObject({ driftyRoute: "local", managedLocalModelId: nextId, managedLocalBaseUrl: "" });
  await act(async () => { install.resolve({ ...next, state: "installed" }); await pending; });
  expect(result.current.setup).toMatchObject({ driftyRoute: "local", managedLocalModelId: nextId, managedLocalBaseUrl: next.baseUrl, managedLocalModel: next.model });
});
