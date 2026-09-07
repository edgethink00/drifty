// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAiSetupController } from "./useAiSetupController";

const storeMocks = vi.hoisted(() => ({
  loadOpenRouterApiKey: vi.fn<() => Promise<string | null>>(),
  saveOpenRouterApiKey: vi.fn<(value: string) => Promise<void>>(),
}));

vi.mock("./openRouterApiKeyStore", () => ({
  loadOpenRouterApiKey: storeMocks.loadOpenRouterApiKey,
  saveOpenRouterApiKey: storeMocks.saveOpenRouterApiKey,
}));

// The connection-test runner and managed-local memory probe both reach native
// commands; stub them so the controller can mount in isolation.
vi.mock("./useAiConnectionTestRunner", () => ({
  useAiConnectionTestRunner: () => ({
    result: null,
    running: false,
    runningFingerprint: null,
    clearResult: () => undefined,
    run: async () => undefined,
    runAuto: async () => undefined,
  }),
}));

vi.mock("./managedLocalAiClient", () => ({
  getManagedLocalAiStatus: vi.fn(async () => {
    throw new Error("managed-local status unavailable in test");
  }),
}));

describe("useAiSetupController OpenRouter key gating", () => {
  beforeEach(() => {
    storeMocks.loadOpenRouterApiKey.mockReset();
    storeMocks.loadOpenRouterApiKey.mockResolvedValue("sk-or-v1-saved");
    storeMocks.saveOpenRouterApiKey.mockReset();
    storeMocks.saveOpenRouterApiKey.mockResolvedValue();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("does not read the Keychain on mount in local mode with the dialog closed", async () => {
    const { result } = renderHook(() => useAiSetupController());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.localAiSetup.provider).toBe("managed_local");
    expect(result.current.aiSetupDialogOpen).toBe(false);
    expect(storeMocks.loadOpenRouterApiKey).not.toHaveBeenCalled();
  });

  it("does not overwrite a newly typed key with a delayed Keychain read", async () => {
    let finishLoad: (key: string) => void = () => undefined;
    storeMocks.loadOpenRouterApiKey.mockImplementation(() => new Promise(resolve => { finishLoad = resolve; }));
    const { result } = renderHook(() => useAiSetupController());
    act(() => result.current.setAiSetupDialogOpen(true));
    await waitFor(() => expect(storeMocks.loadOpenRouterApiKey).toHaveBeenCalledTimes(1));
    act(() => result.current.setLocalAiSetup(current => ({ ...current, openRouterApiKey: "sample-new-key" })));
    await act(async () => finishLoad("sample-old-key"));
    expect(result.current.localAiSetup.openRouterApiKey).toBe("sample-new-key");
  });

  it("reads the Keychain once the BYOK provider becomes active", async () => {
    const { result } = renderHook(() => useAiSetupController());

    await act(async () => {
      await Promise.resolve();
    });
    expect(storeMocks.loadOpenRouterApiKey).not.toHaveBeenCalled();

    act(() => {
      result.current.setLocalAiSetup((current) => ({ ...current, provider: "openrouter_byok" }));
    });

    await waitFor(() => expect(storeMocks.loadOpenRouterApiKey).toHaveBeenCalledTimes(1));
  });

  it("reads the Keychain when the user opens the AI setup dialog", async () => {
    const { result } = renderHook(() => useAiSetupController());

    await act(async () => {
      await Promise.resolve();
    });
    expect(storeMocks.loadOpenRouterApiKey).not.toHaveBeenCalled();

    act(() => {
      result.current.setAiSetupDialogOpen(true);
    });

    await waitFor(() => expect(storeMocks.loadOpenRouterApiKey).toHaveBeenCalledTimes(1));
  });
});
