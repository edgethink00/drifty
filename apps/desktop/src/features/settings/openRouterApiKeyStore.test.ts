// @vitest-environment jsdom
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

  it("gracefully ignores native command failures outside the Tauri runtime", async () => {
    invokeMock.mockRejectedValue(new Error("not running in Tauri"));

    await expect(loadOpenRouterApiKey()).resolves.toBeNull();
    await clearOpenRouterApiKey();

    expect(invokeMock).toHaveBeenCalledWith("openrouter_load_api_key");
    expect(invokeMock).toHaveBeenCalledWith("openrouter_clear_api_key");
  });
});
