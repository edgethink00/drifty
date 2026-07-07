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
});
