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

const customEndpointStoreMocks = vi.hoisted(() => ({
  loadCustomEndpointApiKey: vi.fn<() => Promise<string | null>>(),
  saveCustomEndpointApiKey: vi.fn<(value: string) => Promise<void>>(),
}));

vi.mock("./customEndpointApiKeyStore", () => ({
  loadCustomEndpointApiKey: customEndpointStoreMocks.loadCustomEndpointApiKey,
  saveCustomEndpointApiKey: customEndpointStoreMocks.saveCustomEndpointApiKey,
}));

// The connection-test runner and managed-local memory probe both reach native
// commands; stub them so the controller can mount in isolation.
const runnerOptions = vi.hoisted(() => ({ autoTestPaused: undefined as boolean | undefined }));

vi.mock("./useAiConnectionTestRunner", () => ({
  useAiConnectionTestRunner: (options: { autoTestPaused?: boolean }) => {
    runnerOptions.autoTestPaused = options.autoTestPaused;
    return {
      result: null,
      running: false,
      runningFingerprint: null,
      clearResult: () => undefined,
      run: async () => undefined,
      runAuto: async () => undefined,
    };
  },
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
    customEndpointStoreMocks.loadCustomEndpointApiKey.mockReset();
    customEndpointStoreMocks.loadCustomEndpointApiKey.mockResolvedValue(null);
    customEndpointStoreMocks.saveCustomEndpointApiKey.mockReset();
    customEndpointStoreMocks.saveCustomEndpointApiKey.mockResolvedValue();
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

  it("keeps setup usable when local persistence throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    });
    const { result } = renderHook(() => useAiSetupController());

    act(() => result.current.setLocalAiSetup((current) => ({
      ...current,
      provider: "managed_local",
      driftyRoute: "cloud",
    })));

    expect(result.current.localAiSetup.driftyRoute).toBe("cloud");
  });
});

describe("useAiSetupController custom endpoint key persistence", () => {
  beforeEach(() => {
    storeMocks.loadOpenRouterApiKey.mockReset();
    storeMocks.loadOpenRouterApiKey.mockResolvedValue(null);
    storeMocks.saveOpenRouterApiKey.mockReset();
    storeMocks.saveOpenRouterApiKey.mockResolvedValue();
    customEndpointStoreMocks.loadCustomEndpointApiKey.mockReset();
    customEndpointStoreMocks.loadCustomEndpointApiKey.mockResolvedValue("sk-custom-saved");
    customEndpointStoreMocks.saveCustomEndpointApiKey.mockReset();
    customEndpointStoreMocks.saveCustomEndpointApiKey.mockResolvedValue();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("does not read the credential store when no task uses the custom endpoint", async () => {
    renderHook(() => useAiSetupController());

    await act(async () => {
      await Promise.resolve();
    });

    expect(customEndpointStoreMocks.loadCustomEndpointApiKey).not.toHaveBeenCalled();
  });

  it("restores the saved key after a restart when Classification uses the custom endpoint", async () => {
    window.localStorage.setItem("drifty.aiSetup.v1", JSON.stringify({
      provider: "self_hosted",
      selfHostedBaseUrl: "https://llm.example.com/v1",
      selfHostedModel: "qwen3",
    }));

    const { result } = renderHook(() => useAiSetupController());

    await waitFor(() => expect(result.current.localAiSetup.selfHostedApiKey).toBe("sk-custom-saved"));
    expect(customEndpointStoreMocks.loadCustomEndpointApiKey).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("drifty.aiSetup.v1")).not.toContain("sk-custom-saved");
  });

  it("holds the automatic connection probe until the stored key has loaded", async () => {
    window.localStorage.setItem("drifty.aiSetup.v1", JSON.stringify({
      provider: "self_hosted",
      selfHostedBaseUrl: "https://llm.example.com/v1",
      selfHostedModel: "qwen3",
    }));
    let finishLoad: (key: string | null) => void = () => undefined;
    customEndpointStoreMocks.loadCustomEndpointApiKey.mockImplementation(() => new Promise((resolve) => { finishLoad = resolve; }));

    const { result } = renderHook(() => useAiSetupController());

    await waitFor(() => expect(customEndpointStoreMocks.loadCustomEndpointApiKey).toHaveBeenCalled());
    expect(runnerOptions.autoTestPaused).toBe(true);

    await act(async () => finishLoad("sk-custom-saved"));

    expect(result.current.localAiSetup.selfHostedApiKey).toBe("sk-custom-saved");
    expect(runnerOptions.autoTestPaused).toBe(false);
  });

  it("restores the saved key when only Intelligence uses the custom endpoint", async () => {
    window.localStorage.setItem("drifty.analysisAiSetup.v1", JSON.stringify({ provider: "self_hosted", selfHostedModel: "qwen3" }));

    const { result } = renderHook(() => useAiSetupController());

    await waitFor(() => expect(result.current.localAiSetup.selfHostedApiKey).toBe("sk-custom-saved"));
  });

  it("saves a newly entered key and clears the stored key when it is removed", async () => {
    customEndpointStoreMocks.loadCustomEndpointApiKey.mockResolvedValue(null);
    const { result } = renderHook(() => useAiSetupController());

    act(() => result.current.setLocalAiSetup((current) => ({
      ...current,
      provider: "self_hosted",
      selfHostedApiKey: "sk-custom-new",
    })));

    await waitFor(() => expect(customEndpointStoreMocks.saveCustomEndpointApiKey).toHaveBeenCalledWith("sk-custom-new"));

    act(() => result.current.setLocalAiSetup((current) => ({ ...current, selfHostedApiKey: "" })));

    await waitFor(() => expect(customEndpointStoreMocks.saveCustomEndpointApiKey).toHaveBeenLastCalledWith(""));
  });
});
