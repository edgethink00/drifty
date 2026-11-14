// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ScreenContextClient } from "../screen-context/screenContextClient";
import { MEMORY_MAY_BE_ON_STORAGE_KEY } from "./memoryBeta";
import { MemoryPage } from "./MemoryPage";

const runtime = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: runtime.invoke }));

const lease = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
type Options = { supported?: boolean; keys?: { anthropic: boolean; cloud: boolean }; recording?: boolean; permitted?: boolean };

function setup({ supported = true, keys = { anthropic: false, cloud: true }, recording = false, permitted = true }: Options = {}) {
  let memory = { enabled: false, retentionHours: 24, workSites: ["github.com"], apps: [] as string[] };
  let recordingOn = recording;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    let value: unknown;
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_permission_status") return { granted: permitted };
    if (command === "screen_context_bind_account") value = { mode: "local", expiresAtMs: Date.now() + 900000 };
    else if (command === "memory_get_status") value = { supported, preferences: memory, ...(args?.includeCredentials ? { credentials: keys } : {}), status: null };
    else if (command === "memory_wiki_pages") value = { pages: [] };
    else if (command === "screen_context_get_status") value = {
      preferences: { scope: "active_display_scene", enabled: recordingOn, replayEnabled: true, visibleTextEnabled: false, ocrEnabled: true, allowedApps: [], intervalSeconds: 10 },
      preferencesInvalid: false, captureEnabled: recordingOn, generalCaptureSupported: true, helperInstalled: true, globalPaused: false, ocrSupported: true,
      supportedApps: [{ id: "slack", name: "Slack" }], paused: false, running: true, preparing: false, accepted: 0, dropped: 0, lastFailure: null, lastAcceptedAtMs: null,
    };
    else if (command === "screen_context_configure") { recordingOn = true; value = (await invoke("screen_context_get_status") as { value: unknown }).value; }
    else if (command === "memory_configure") { memory = args?.preferences as typeof memory; value = { saved: true }; }
    else throw new Error(command);
    return { leaseId: lease, value };
  });
  const client = new ScreenContextClient(invoke, true);
  client.setAccount(null);
  const onOpenAiSettings = vi.fn();
  render(<LocalizationTestProvider language="en"><MemoryPage client={client} onOpenSettings={vi.fn()} onOpenAiSettings={onOpenAiSettings} /></LocalizationTestProvider>);
  return { invoke, onOpenAiSettings };
}
const calls = (invoke: ReturnType<typeof setup>["invoke"], name: string) => invoke.mock.calls.filter(([command]) => command === name).map(([, args]) => args);

beforeEach(() => { window.localStorage.clear(); runtime.invoke.mockReset(); });
afterEach(cleanup);

describe("Memory page start", () => {
  it("starts memory with one press: recording on, every supported app, no consent step", async () => {
    const { invoke } = setup();
    expect(await screen.findByRole("heading", { name: "Keep what you saw while working, organized for you" })).toBeTruthy();
    // The start screen names no destination and offers no choices.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/Claude|Anthropic|Drifty Cloud/)).toBeNull();
    expect((screen.getByRole("tab", { name: "Graph" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Start automatic memory" }));
    await waitFor(() => expect(calls(invoke, "memory_configure")).toHaveLength(1));
    expect(calls(invoke, "screen_context_configure")[0]).toMatchObject({ preferences: { enabled: true }, resume: true });
    expect(calls(invoke, "memory_configure")[0]).toEqual({
      preferences: { enabled: true, retentionHours: 24, workSites: ["github.com"], apps: [] }, acknowledgeExternalText: true, leaseId: lease,
    });
    expect(await screen.findByRole("heading", { name: "Memory is on" })).toBeTruthy();
    expect(window.localStorage.getItem(MEMORY_MAY_BE_ON_STORAGE_KEY)).toBe("1");
    // The engine was already installed, so nothing was downloaded.
    expect(runtime.invoke).not.toHaveBeenCalledWith("memory_runtime_install");
  });

  it("asks for an AI connection instead of starting when neither Drifty Cloud nor a key is available", async () => {
    const { invoke, onOpenAiSettings } = setup({ keys: { anthropic: false, cloud: false } });
    fireEvent.click(await screen.findByRole("button", { name: "Connect AI" }));
    expect(onOpenAiSettings).toHaveBeenCalled();
    expect(screen.getByText("No key needed with a trial or Pro")).toBeTruthy();
    expect(calls(invoke, "memory_configure")).toHaveLength(0);
  });

  it("asks macOS for screen recording when it is not allowed yet", async () => {
    const { invoke } = setup({ permitted: false });
    fireEvent.click(await screen.findByRole("button", { name: "Start automatic memory" }));
    expect(await screen.findByRole("button", { name: "Allow screen recording" })).toBeTruthy();
    expect(screen.getByText("Allow it in System Settings and come back to continue")).toBeTruthy();
    expect(calls(invoke, "memory_configure")).toHaveLength(0);
  });

  it("downloads a missing engine in place of the button and offers a retry when it fails", async () => {
    runtime.invoke.mockImplementation(async (command: string) => {
      if (command === "memory_runtime_status") return { phase: "missing", received: 0, total: 72 * 1024 * 1024 };
      throw new Error("download failed");
    });
    const { invoke } = setup({ supported: false });
    fireEvent.click(await screen.findByRole("button", { name: "Start automatic memory" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText(/Couldn’t download/)).toBeTruthy();
    expect(runtime.invoke).toHaveBeenCalledWith("memory_runtime_install");
    expect(calls(invoke, "memory_configure")).toHaveLength(0);
  });

  it("says when this Mac cannot run memory", async () => {
    runtime.invoke.mockResolvedValue({ phase: "unsupported", received: 0, total: 0 });
    setup({ supported: false });
    expect(await screen.findByRole("heading", { name: "Not available on this Mac yet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start automatic memory" })).toBeNull();
  });
});
