// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAnalysisModelSetup } from "./useAnalysisModelSetup";
import { ANALYSIS_AI_SETUP_STORAGE_KEY } from "./analysisModelSetup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOpenRouterApiKey,
  loadOpenRouterApiKey,
  saveOpenRouterApiKey,
} from "./openRouterApiKeyStore";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("openRouterApiKeyStore", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates Intelligence readiness after a shared key is saved and cleared without changing provider", async () => {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify({ provider: "openrouter" }));
    let storedKey: string | null = null;
    invokeMock.mockImplementation(async (command: string, args?: { value: string }) => {
      if (command === "openrouter_save_api_key") storedKey = args?.value ?? null;
      if (command === "openrouter_clear_api_key") storedKey = null;
      return command === "openrouter_load_api_key" ? storedKey : undefined;
    });
    const { result } = renderHook(() => useAnalysisModelSetup(false));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("openrouter_load_api_key"));
    expect(result.current.analysisConnected).toBe(false);
    await act(async () => { await saveOpenRouterApiKey("sample-native-key"); });
    await waitFor(() => expect(result.current.analysisConnected).toBe(true));
    await act(async () => { await clearOpenRouterApiKey(); });
    await waitFor(() => expect(result.current.analysisConnected).toBe(false));
    window.localStorage.clear();
  });

  it("loads the saved OpenRouter key from native Keychain storage", async () => {
    invokeMock.mockResolvedValue("sk-or-v1-saved");

    await expect(loadOpenRouterApiKey()).resolves.toBe("sk-or-v1-saved");
    expect(invokeMock).toHaveBeenCalledWith("openrouter_load_api_key");
  });

  it("saves trimmed OpenRouter key material only through the native command", async () => {
    invokeMock.mockResolvedValue(undefined);

    await saveOpenRouterApiKey("  sk-or-v1-secret  ");

    expect(invokeMock).toHaveBeenCalledWith("openrouter_save_api_key", { value: "sk-or-v1-secret" });
    expect(window.localStorage.getItem("openRouterApiKey")).toBeNull();
  });

  it("clears the native key when the value is empty", async () => {
    invokeMock.mockResolvedValue(undefined);

    await saveOpenRouterApiKey("   ");

    expect(invokeMock).toHaveBeenCalledWith("openrouter_clear_api_key");
  });

  it("keeps failed writes observable while legacy optional reads can return null", async () => {
    invokeMock.mockRejectedValue(new Error("not running in Tauri"));

    await expect(loadOpenRouterApiKey()).resolves.toBeNull();
    await expect(clearOpenRouterApiKey()).rejects.toThrow("Unable to save provider credentials.");

    expect(invokeMock).toHaveBeenCalledWith("openrouter_load_api_key");
    expect(invokeMock).toHaveBeenCalledWith("openrouter_clear_api_key");
  });
});
