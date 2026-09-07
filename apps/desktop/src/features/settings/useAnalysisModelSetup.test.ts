// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYSIS_AI_SETUP_STORAGE_KEY } from "./analysisModelSetup";
import { useAnalysisModelSetup } from "./useAnalysisModelSetup";

const storeMocks = vi.hoisted(() => ({
  loadOpenRouterApiKey: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("./openRouterApiKeyStore", () => ({
  loadOpenRouterApiKey: storeMocks.loadOpenRouterApiKey,
  subscribeOpenRouterKeyPresence: () => () => undefined,
}));

describe("useAnalysisModelSetup OpenRouter key gating", () => {
  beforeEach(() => {
    storeMocks.loadOpenRouterApiKey.mockReset();
    storeMocks.loadOpenRouterApiKey.mockResolvedValue(null);
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
