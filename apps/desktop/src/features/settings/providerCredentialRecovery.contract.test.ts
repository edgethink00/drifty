import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { recoverOpenRouterApiKey } from "./openRouterApiKeyStore";
import { recoverCustomEndpointApiKey } from "./customEndpointApiKeyStore";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => invoke.mockReset());
describe.each([
  { recover: recoverOpenRouterApiKey, command: "openrouter_recover_api_key" },
  { recover: recoverCustomEndpointApiKey, command: "custom_endpoint_recover_api_key" },
])("$command explicit recovery contract", ({ recover, command }) => {
  it("distinguishes restoring an unknown key from clearing a key", async () => {
    invoke.mockResolvedValueOnce("synthetic-saved");
    expect(await recover()).toBe("synthetic-saved");
    expect(invoke).toHaveBeenLastCalledWith(command, { value: null });
    invoke.mockResolvedValueOnce(null);
    expect(await recover("")).toBeNull();
    expect(invoke).toHaveBeenLastCalledWith(command, { value: "" });
  });
  it("does not report durability when native confirmation disagrees with the edit", async () => {
    invoke.mockResolvedValueOnce("synthetic-older");
    await expect(recover("synthetic-newer")).rejects.toThrow("Unable to recover provider credentials.");
    invoke.mockRejectedValueOnce(new Error("synthetic native refusal"));
    await expect(recover()).rejects.toThrow("Unable to recover provider credentials.");
  });
});
it("allows explicit recovery only in the main window", () => {
  const directory = new URL("../../../../../src-tauri/capabilities/", import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith(".json"))) {
    const capability = JSON.parse(readFileSync(fileURLToPath(new URL(file, directory)), "utf8"));
    for (const permission of ["allow-openrouter-recover-api-key", "allow-custom-endpoint-recover-api-key"]) {
      expect(capability.permissions.includes(permission), file).toBe(file === "main-window.json");
    }
  }
});
