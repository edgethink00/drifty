// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYSIS_AI_SETUP_STORAGE_KEY, DEFAULT_ANALYSIS_AI_SETUP, toPersistedAnalysisAiSetup } from "./analysisModelSetup";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";
import { useAnalysisModelSetup } from "./useAnalysisModelSetup";

const directMocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
// Keep the real store/queue in this composed test; mock only the native boundary.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string, args: { provider: string; value?: string }) => {
  if (command === "analysis_provider_load_api_key") return directMocks.load(args.provider);
  if (command === "analysis_provider_save_api_key") return directMocks.save(args.provider, args.value);
  throw new Error("Unexpected native credential command.");
}) }));

const storeMocks = vi.hoisted(() => ({
  loadOpenRouterApiKey: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("./openRouterApiKeyStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("./openRouterApiKeyStore")>(),
  loadOpenRouterApiKey: storeMocks.loadOpenRouterApiKey,
  subscribeOpenRouterKeyPresence: () => () => undefined,
}));

describe("useAnalysisModelSetup OpenRouter key gating", () => {
  beforeEach(() => {
    storeMocks.loadOpenRouterApiKey.mockReset();
    storeMocks.loadOpenRouterApiKey.mockResolvedValue(null);
    directMocks.load.mockReset().mockResolvedValue(null);
    directMocks.save.mockReset().mockResolvedValue(undefined);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("does not touch the Keychain on mount when the analysis provider is not OpenRouter", async () => {
    const { result } = renderHook(() => useAnalysisModelSetup(true));

    // Flush any pending microtasks so a stray effect-triggered read would surface.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.analysisSetup.provider).toBe("cloud");
    expect(storeMocks.loadOpenRouterApiKey).not.toHaveBeenCalled();
    expect(directMocks.load).not.toHaveBeenCalled();
  });

  it("reads the Keychain on mount when the persisted analysis provider is OpenRouter", async () => {
    window.localStorage.setItem(
      ANALYSIS_AI_SETUP_STORAGE_KEY,
      JSON.stringify({ provider: "openrouter" }),
    );

    renderHook(() => useAnalysisModelSetup(true));

    await waitFor(() => expect(storeMocks.loadOpenRouterApiKey).toHaveBeenCalledTimes(1));
  });

  it("reads the Keychain once the provider switches to OpenRouter", async () => {
    const { result } = renderHook(() => useAnalysisModelSetup(true));

    await act(async () => {
      await Promise.resolve();
    });
    expect(storeMocks.loadOpenRouterApiKey).not.toHaveBeenCalled();

    act(() => {
      result.current.setAnalysisSetup({ ...result.current.analysisSetup, provider: "openrouter" });
    });

    await waitFor(() => expect(storeMocks.loadOpenRouterApiKey).toHaveBeenCalledTimes(1));
  });

  it("reuses the shared custom connection while keeping the Intelligence model independent", () => {
    const onSharedConnectionChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ baseUrl, apiKey }) => useAnalysisModelSetup(true, "self_hosted", {
        baseUrl,
        apiKey,
        onChange: onSharedConnectionChange,
      }),
      { initialProps: { baseUrl: "http://localhost:11434/v1", apiKey: "session-key" } },
    );

    expect(result.current.analysisSetup.selfHostedBaseUrl).toBe("http://localhost:11434/v1");
    expect(result.current.analysisSetup.selfHostedApiKey).toBe("session-key");

    act(() => {
      result.current.setAnalysisSetup({
        ...result.current.analysisSetup,
        provider: "self_hosted",
        selfHostedBaseUrl: "https://models.example/v1",
        selfHostedApiKey: "new-session-key",
        selfHostedModel: "analysis-model",
      });
    });

    expect(onSharedConnectionChange).toHaveBeenCalledWith({
      baseUrl: "https://models.example/v1",
      apiKey: "new-session-key",
    });
    rerender({ baseUrl: "https://models.example/v1", apiKey: "new-session-key" });
    expect(result.current.analysisSetup.selfHostedModel).toBe("analysis-model");
    const persistedSetup = window.localStorage.getItem(ANALYSIS_AI_SETUP_STORAGE_KEY);
    expect(persistedSetup).not.toContain("new-session-key");
    expect(persistedSetup).not.toContain("https://models.example/v1");
  });

  it("adopts Classification connection edits without overwriting the saved Intelligence model", () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify({
      provider: "self_hosted",
      selfHostedModel: "intelligence-reasoning-model",
    }));
    const onSharedConnectionChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ baseUrl, apiKey }) => useAnalysisModelSetup(true, "self_hosted", {
        baseUrl,
        apiKey,
        onChange: onSharedConnectionChange,
      }),
      { initialProps: { baseUrl: "https://old.example/v1", apiKey: "old-session-key" } },
    );

    rerender({ baseUrl: "https://new.example/v1", apiKey: "new-session-key" });

    expect(result.current.analysisSetup).toMatchObject({
      provider: "self_hosted",
      selfHostedBaseUrl: "https://new.example/v1",
      selfHostedApiKey: "new-session-key",
      selfHostedModel: "intelligence-reasoning-model",
    });
    expect(onSharedConnectionChange).not.toHaveBeenCalled();
  });

  it("does not report Intelligence as connected for an invalid shared endpoint URL", () => {
    const { result } = renderHook(() => useAnalysisModelSetup(true, "self_hosted", {
      baseUrl: "not-a-valid-url",
      apiKey: "session-key",
      onChange: vi.fn(),
    }));

    act(() => {
      result.current.setAnalysisSetup({
        ...result.current.analysisSetup,
        provider: "self_hosted",
        selfHostedModel: "analysis-model",
      });
    });

    expect(result.current.analysisConnected).toBe(false);
  });

  it("migrates an existing Intelligence custom endpoint when Classification has no custom model", () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify({
      provider: "self_hosted",
      selfHostedBaseUrl: "https://legacy-intelligence.example/v1",
      selfHostedModel: "analysis-model",
    }));
    const onSharedConnectionChange = vi.fn();

    renderHook(() => useAnalysisModelSetup(true, "managed_local", {
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      preferStoredConnection: true,
      onChange: onSharedConnectionChange,
    }));

    expect(onSharedConnectionChange).toHaveBeenCalledWith({
      baseUrl: "https://legacy-intelligence.example/v1",
      apiKey: "",
    });
    expect(window.localStorage.getItem(ANALYSIS_AI_SETUP_STORAGE_KEY)).not.toContain("legacy-intelligence.example");
  });

  it("removes the legacy duplicate URL even when Classification already owns the connection", async () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify({
      provider: "self_hosted",
      selfHostedBaseUrl: "https://legacy-intelligence.example/v1",
      selfHostedModel: "analysis-model",
    }));
    const onSharedConnectionChange = vi.fn();

    renderHook(() => useAnalysisModelSetup(true, "self_hosted", {
      baseUrl: "https://classification-owned.example/v1",
      apiKey: "session-key",
      preferStoredConnection: false,
      onChange: onSharedConnectionChange,
    }));

    await waitFor(() => expect(window.localStorage.getItem(ANALYSIS_AI_SETUP_STORAGE_KEY)).not.toContain("legacy-intelligence.example"));
    expect(onSharedConnectionChange).not.toHaveBeenCalled();
  });
});


describe("Intelligence Cloud recovery and credential restoration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    directMocks.load.mockReset().mockResolvedValue(null);
    directMocks.save.mockReset().mockResolvedValue(undefined);
    storeMocks.loadOpenRouterApiKey.mockReset().mockResolvedValue(null);
  });
  afterEach(() => window.localStorage.clear());
  const eligible = { ownerKey: "account-a", cloudFallbackAllowed: true, cloudReady: true };
  it("waits for the Anthropic key read, then executes on Cloud while retaining the preference", async () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify({ provider: "anthropic" }));
    let finish!: (value: string | null) => void;
    directMocks.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useAnalysisModelSetup(true, "managed_local", undefined, eligible));
    expect(result.current.analysisConnected).toBe(false);
    expect(result.current.effectiveAnalysisSetup.provider).toBe("anthropic");
    await waitFor(() => expect(directMocks.load).toHaveBeenCalled());
    await act(async () => finish(null));
    expect(result.current.analysisConnected).toBe(true);
    expect(result.current.effectiveAnalysisSetup.provider).toBe("cloud");
    expect(result.current.analysisSetup.provider).toBe("anthropic");
    expect(JSON.parse(window.localStorage.getItem(ANALYSIS_AI_SETUP_STORAGE_KEY)!)).toEqual({ provider: "anthropic" });
  });
  it("restores a direct key and preserves a healthy preference across restart", async () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify({ provider: "anthropic" }));
    directMocks.load.mockResolvedValue("synthetic-restored-key");
    const { result } = renderHook(() => useAnalysisModelSetup(true, "managed_local", undefined, eligible));
    await waitFor(() => expect(result.current.analysisConnected).toBe(true));
    expect(result.current.effectiveAnalysisSetup.provider).toBe("anthropic");
    expect(result.current.analysisSetup.anthropicApiKey).toBe("synthetic-restored-key");
    expect(window.localStorage.getItem(ANALYSIS_AI_SETUP_STORAGE_KEY)).not.toContain("synthetic-restored-key");
  });
  it("does not turn denied credential-store access into missing credentials", async () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify({ provider: "openai" }));
    directMocks.load.mockRejectedValue(new Error("access denied"));
    const { result } = renderHook(() => useAnalysisModelSetup(true, "managed_local", undefined, eligible));
    await act(async () => {});
    expect(result.current.effectiveAnalysisSetup.provider).toBe("openai");
    expect(result.current.analysisConnected).toBe(false);
  });
  it("rejects old account callbacks and Cloud eligibility after account change", async () => {
    const { result, rerender } = renderHook(({ ownerKey }) => useAnalysisModelSetup(true, "managed_local", undefined, { ...eligible, ownerKey }), { initialProps: { ownerKey: "account-a" } });
    const oldCanFallback = result.current.canFallbackNow;
    const oldMark = result.current.markUnavailable;
    rerender({ ownerKey: "account-b" });
    expect(oldCanFallback()).toBe(false);
    act(() => oldMark("authentication"));
    expect(result.current.analysisSetup.provider).toBe("cloud");
  });
  it("does not pin an automatically stored OpenRouter snapshot after Cloud activation fails", () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify(toPersistedAnalysisAiSetup({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openrouter", selectionSource: "automatic" })));
    const { result } = renderHook(() => useAnalysisModelSetup(true, "managed_local", undefined, eligible));
    expect(result.current.analysisSetup.provider).toBe("cloud");
  });
  it("saves direct keys through native storage without leaking into settings", async () => {
    const { result, unmount } = renderHook(() => useAnalysisModelSetup(true));
    act(() => result.current.setAnalysisSetup({ ...result.current.analysisSetup, anthropicApiKey: "synthetic-edit" }));
    expect(window.localStorage.getItem(ANALYSIS_AI_SETUP_STORAGE_KEY)).not.toContain("synthetic-edit");
    unmount();
    await waitFor(() => expect(directMocks.save).toHaveBeenCalledWith("anthropic", "synthetic-edit"));
  });
  it("keeps an explicit manual OpenAI default instead of applying the old default migration", async () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify(toPersistedAnalysisAiSetup({ ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openai", selectionSource: "manual" })));
    directMocks.load.mockResolvedValue("synthetic-key");
    const { result } = renderHook(() => useAnalysisModelSetup(true, "managed_local", undefined, eligible));
    await waitFor(() => expect(result.current.analysisConnected).toBe(true));
    expect(result.current.effectiveAnalysisSetup.provider).toBe("openai");
  });
  it("restores the preference immediately after fixing its key and retries an unchanged route after cooldown", async () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify({ provider: "anthropic" }));
    directMocks.load.mockResolvedValue("synthetic-key");
    const { result, unmount } = renderHook(() => useAnalysisModelSetup(true, "managed_local", undefined, eligible));
    await waitFor(() => expect(result.current.analysisConnected).toBe(true));
    vi.useFakeTimers();
    try {
      act(() => result.current.markUnavailable("authentication"));
      expect(result.current.effectiveAnalysisSetup.provider).toBe("cloud");
      act(() => result.current.setAnalysisSetup({ ...result.current.analysisSetup, anthropicApiKey: "synthetic-fixed" }));
      expect(result.current.effectiveAnalysisSetup.provider).toBe("anthropic");
      act(() => result.current.markUnavailable("model_unavailable"));
      expect(result.current.effectiveAnalysisSetup.provider).toBe("cloud");
      act(() => vi.advanceTimersByTime(5 * 60_000));
      expect(result.current.effectiveAnalysisSetup.provider).toBe("anthropic");
      unmount();
    } finally { vi.useRealTimers(); }
  });
  it("keeps a newly edited direct key over a delayed native load", async () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify({ provider: "anthropic" }));
    let finish!: (key: string) => void;
    directMocks.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useAnalysisModelSetup(true, "managed_local", undefined, eligible));
    act(() => result.current.setAnalysisSetup({ ...result.current.analysisSetup, anthropicApiKey: "synthetic-new-key" }));
    await waitFor(() => expect(directMocks.load).toHaveBeenCalled());
    await act(async () => finish("synthetic-old-key"));
    expect(result.current.analysisSetup.anthropicApiKey).toBe("synthetic-new-key");
    expect(result.current.effectiveAnalysisSetup.provider).toBe("anthropic");
    unmount();
    await waitFor(() => expect(directMocks.save).toHaveBeenCalledWith("anthropic", "synthetic-new-key"));
  });
  it("serializes native writes so a late save cannot restore a cleared key", async () => {
    const { result, unmount } = renderHook(() => useAnalysisModelSetup(true));
    let finishSave!: () => void;
    directMocks.save.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
    vi.useFakeTimers();
    try {
      act(() => result.current.setAnalysisSetup({ ...result.current.analysisSetup, openaiApiKey: "synthetic-key" }));
      await act(async () => vi.advanceTimersByTime(250));
      expect(directMocks.save).toHaveBeenCalledTimes(1);
      act(() => result.current.setAnalysisSetup({ ...result.current.analysisSetup, openaiApiKey: "" }));
      await act(async () => vi.advanceTimersByTime(250));
      expect(directMocks.save).toHaveBeenCalledTimes(1);
      await act(async () => finishSave());
      expect(directMocks.save).toHaveBeenLastCalledWith("openai", "");
      unmount();
    } finally { vi.useRealTimers(); }
  });

  it("revokes a pending Cloud fallback when the settings owner unmounts", () => {
    const { result, unmount } = renderHook(() => useAnalysisModelSetup(true, "managed_local", undefined, eligible));
    const canFallback = result.current.canFallbackNow;
    expect(canFallback()).toBe(true);
    unmount();
    expect(canFallback()).toBe(false);
  });

});


describe("shared connection in the running app", () => {
  beforeEach(() => { window.localStorage.clear(); storeMocks.loadOpenRouterApiKey.mockClear(); directMocks.load.mockClear(); });
  it("follows Local without reading credentials and can restore automatic mode after a manual override", () => {
    const local = { ...DEFAULT_LOCAL_AI_SETUP, driftyRoute: "local" as const, managedLocalBaseUrl: "http://127.0.0.1:39217/v1", managedLocalModel: "local-four" };
    const { result, rerender } = renderHook(({ connection }) => useAnalysisModelSetup(true, connection.provider, undefined,
      { ownerKey: "local", cloudFallbackAllowed: false, cloudReady: true, liveSetup: connection }), { initialProps: { connection: local } });
    expect(result.current.analysisSetup.provider).toBe("managed_local");
    expect(result.current.analysisConnected).toBe(true);
    expect(result.current.analysisConfigured).toBe(true);
    expect(storeMocks.loadOpenRouterApiKey).not.toHaveBeenCalled(); expect(directMocks.load).not.toHaveBeenCalled();
    const oldScope = result.current.requestScopeKey;
    rerender({ connection: { ...local, managedLocalModel: "local-two", managedLocalModelId: "drifty-qwen3-5-2b-economy" } });
    expect(result.current.requestScopeKey).not.toBe(oldScope);
    act(() => result.current.setAnalysisSetup({ ...result.current.analysisSetup, provider: "cloud", selectionSource: "manual" }));
    expect(result.current.analysisSetup.provider).toBe("cloud");
    act(() => result.current.setAnalysisSetup({ ...result.current.analysisSetup, selectionSource: "automatic" }));
    expect(result.current.analysisSetup).toMatchObject({ provider: "managed_local", managedLocal: { model: "local-two" } });
  });
});
