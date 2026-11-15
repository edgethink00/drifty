// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ScreenContextClient } from "../screen-context/screenContextClient";
import { MEMORY_MAY_BE_ON_STORAGE_KEY } from "./memoryBeta";
import { MEMORY_START_PENDING_STORAGE_KEY, memoryStartReopens } from "./memoryInstaller";
import { MemoryPage } from "./MemoryPage";

const runtime = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: runtime.invoke }));

const lease = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const MB = 1024 * 1024;
type Keys = { anthropic: boolean; cloud: boolean };
type Options = { supported?: boolean; keys?: Keys | (() => Keys); recording?: boolean; permitted?: boolean; sources?: number; trackerLate?: boolean };

/** The native downloads: each starts missing (or ready) and finishes when installed. */
function downloads({ engine = "ready", models = "ready", fail }: { engine?: string; models?: string; fail?: string } = {}) {
  const phase: Record<string, string> = { engine, models };
  const order: string[] = [];
  runtime.invoke.mockImplementation(async (command: string) => {
    order.push(command);
    if (command === "memory_runtime_status") return { phase: phase.engine, received: 0, total: 66 * MB };
    if (command === "memory_models_status") return { phase: phase.models, received: 0, total: 255 * MB };
    const step = command === "memory_runtime_install" ? "engine" : command === "memory_models_install" ? "models" : null;
    if (!step) throw new Error(command);
    if (fail === step) throw new Error("download failed");
    phase[step] = "ready";
  });
  return order;
}

function setup({ supported = true, keys = { anthropic: false, cloud: true }, recording = false, permitted = true, sources = 0, trackerLate = false }: Options = {}) {
  let lateLeft = trackerLate ? 1 : 0;
  let memory = { enabled: false, retentionHours: 24, workSites: ["github.com"], apps: [] as string[] };
  let recordingOn = recording;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    let value: unknown;
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_permission_status") return { granted: permitted };
    if (command === "screen_context_bind_account") value = { mode: "local", expiresAtMs: Date.now() + 900000 };
    else if (command === "memory_get_status") value = { supported, preferences: memory, ...(args?.includeCredentials ? { credentials: typeof keys === "function" ? keys() : keys } : {}),
      status: memory.enabled ? { active: true, sources, remembered_groups: 0, route: { kind: "cloud", error: null, embedding: "ready" } } : null };
    else if (command === "memory_wiki_pages") value = { pages: [] };
    else if (command === "screen_context_get_status") value = {
      preferences: { scope: "active_display_scene", enabled: recordingOn, replayEnabled: true, visibleTextEnabled: false, ocrEnabled: true, allowedApps: [], intervalSeconds: 10 },
      preferencesInvalid: false, captureEnabled: recordingOn, generalCaptureSupported: true, helperInstalled: true, globalPaused: false, ocrSupported: true,
      supportedApps: [{ id: "slack", name: "Slack" }], paused: false, running: true, preparing: false, accepted: 0, dropped: 0, lastFailure: null, lastAcceptedAtMs: null,
    };
    else if (command === "screen_context_configure") { if (lateLeft > 0) { lateLeft -= 1; throw new Error("screen_context_tracker_not_ready"); } recordingOn = true; value = (await invoke("screen_context_get_status") as { value: unknown }).value; }
    else if (command === "screen_context_request_permission") value = { granted: false };
    else if (command === "memory_configure") { await new Promise((resolve) => setTimeout(resolve, 30)); memory = args?.preferences as typeof memory; value = { saved: true }; }
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
const steps = (name = "Start automatic memory") => within(screen.getByRole("list", { name })).getAllByRole("listitem").map((item) => item.className.replace("memory-setup__row is-", "") + ":" + item.querySelector(".memory-setup__label")?.textContent);
const pending = () => JSON.parse(window.localStorage.getItem(MEMORY_START_PENDING_STORAGE_KEY) ?? "null") as Record<string, unknown> | null;

beforeEach(() => { window.localStorage.clear(); runtime.invoke.mockReset(); });
afterEach(cleanup);

describe("Memory page start", () => {
  it("starts memory with one press: recording on, every supported app, no consent step", async () => {
    downloads();
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
    expect(pending()).toBeNull();
    // The engine and the search model were already there, so nothing was downloaded.
    expect(runtime.invoke).not.toHaveBeenCalledWith("memory_runtime_install");
    expect(runtime.invoke).not.toHaveBeenCalledWith("memory_models_install");
    // Until the first screen is read it says what starts it.
    expect(steps("Memory is on")).toEqual(["wait:Read work screens", "todo:First memory"]);
    expect(screen.getByText("Starts when you use another app")).toBeTruthy();
  });

  it("downloads the engine and then the search model back to back, and asks for screen recording last", async () => {
    const order = downloads({ engine: "missing", models: "missing" });
    const { invoke } = setup({ supported: false, permitted: false });
    expect(await screen.findByText("Downloads about 320 MB once")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start automatic memory" }));
    const allow = await screen.findByRole("button", { name: "Allow" });
    expect(order.filter((command) => command.endsWith("_install"))).toEqual(["memory_runtime_install", "memory_models_install"]);
    expect(steps()).toEqual(["done:Download the memory engine", "done:Download the search model", "wait:Allow screen recording"]);
    expect(screen.getByText("Drifty reopens once after you allow it.")).toBeTruthy();
    expect(calls(invoke, "screen_context_request_permission")).toHaveLength(0);
    expect(calls(invoke, "memory_configure")).toHaveLength(0);
    // The steps are remembered for the reopened app.
    expect(pending()).toMatchObject({ engine: true, models: true, key: false, permission: true });
    fireEvent.click(allow);
    await waitFor(() => expect(calls(invoke, "screen_context_request_permission")).toHaveLength(1));
    // Even if the start finishes before macOS reopens the app, the reopened app comes back here.
    window.localStorage.removeItem(MEMORY_START_PENDING_STORAGE_KEY);
    expect(memoryStartReopens()).toBe(true);
    expect(memoryStartReopens(Date.now() + 11 * 60_000)).toBe(false);
  });

  it("carries the start on when macOS reopens the app after the grant", async () => {
    downloads();
    window.localStorage.setItem(MEMORY_START_PENDING_STORAGE_KEY, JSON.stringify({ at: Date.now() - 20_000, engine: true, models: true, key: false, permission: true }));
    const { invoke } = setup({ permitted: true });
    await waitFor(() => expect(calls(invoke, "memory_configure")).toHaveLength(1));
    expect(await screen.findByRole("heading", { name: "Memory is on" })).toBeTruthy();
    expect(pending()).toBeNull();
  });

  it("keeps the steps on screen while turning memory on starts a new generation, and turns it on once", async () => {
    downloads();
    window.localStorage.setItem(MEMORY_START_PENDING_STORAGE_KEY, JSON.stringify({ at: Date.now() - 20_000, engine: false, models: true, key: false, permission: true }));
    const { invoke } = setup({ permitted: true });
    expect(await screen.findByText("Turning memory on")).toBeTruthy();
    expect(screen.queryByText("Loading memory…")).toBeNull();
    expect(steps()).toEqual(["done:Download the search model", "done:Allow screen recording"]);
    expect(await screen.findByRole("heading", { name: "Memory is on" })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls(invoke, "memory_configure")).toHaveLength(1);
  });

  it("waits for tracking to start when the reopened app turns recording on before it is ready", async () => {
    downloads();
    window.localStorage.setItem(MEMORY_START_PENDING_STORAGE_KEY, JSON.stringify({ at: Date.now() - 20_000, engine: false, models: false, key: false, permission: true }));
    const { invoke } = setup({ permitted: true, trackerLate: true });
    await waitFor(() => expect(calls(invoke, "memory_configure")).toHaveLength(1), { timeout: 4000 });
    expect(calls(invoke, "screen_context_configure")).toHaveLength(2);
    expect(await screen.findByRole("heading", { name: "Memory is on" })).toBeTruthy();
  });

  it("does not resume a start pressed long ago", async () => {
    downloads();
    window.localStorage.setItem(MEMORY_START_PENDING_STORAGE_KEY, JSON.stringify({ at: Date.now() - 2 * 3600_000, engine: false, models: true, key: false, permission: true }));
    const { invoke } = setup();
    expect(await screen.findByRole("button", { name: "Start automatic memory" })).toBeTruthy();
    expect(calls(invoke, "memory_configure")).toHaveLength(0);
  });

  it("asks for an AI connection after the downloads when neither Drifty Cloud nor a key is available", async () => {
    downloads({ models: "missing" });
    const { invoke, onOpenAiSettings } = setup({ keys: { anthropic: false, cloud: false }, permitted: false });
    fireEvent.click(await screen.findByRole("button", { name: "Start automatic memory" }));
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    expect(onOpenAiSettings).toHaveBeenCalled();
    expect(runtime.invoke).toHaveBeenCalledWith("memory_models_install");
    expect(steps()).toEqual(["done:Download the search model", "wait:AI connection", "todo:Allow screen recording"]);
    expect(screen.getByText("No key needed with a trial or Pro")).toBeTruthy();
    expect(calls(invoke, "screen_context_request_permission")).toHaveLength(0);
    expect(calls(invoke, "memory_configure")).toHaveLength(0);
  });

  it("carries on by itself when a trial or Pro session reaches the engine after the page first looked", async () => {
    downloads({ models: "missing" });
    // The page's first reads still see no connection; the session arrives while the model downloads.
    let reads = 0;
    const { invoke } = setup({ keys: () => (++reads <= 3 ? { anthropic: false, cloud: false } : { anthropic: false, cloud: true }) });
    fireEvent.click(await screen.findByRole("button", { name: "Start automatic memory" }));
    expect(await screen.findByRole("button", { name: "Connect" })).toBeTruthy();
    await waitFor(() => expect(calls(invoke, "memory_configure")).toHaveLength(1), { timeout: 4000 });
    expect(await screen.findByRole("heading", { name: "Memory is on" })).toBeTruthy();
  });

  it("shows no AI connection step to someone who has one", async () => {
    downloads({ models: "missing" });
    setup({ permitted: false });
    fireEvent.click(await screen.findByRole("button", { name: "Start automatic memory" }));
    await screen.findByRole("button", { name: "Allow" });
    expect(steps()).toEqual(["done:Download the search model", "wait:Allow screen recording"]);
  });

  it("offers a retry on the step that failed and stops there", async () => {
    downloads({ engine: "missing", models: "missing", fail: "engine" });
    const { invoke } = setup({ supported: false });
    fireEvent.click(await screen.findByRole("button", { name: "Start automatic memory" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText("Couldn’t download")).toBeTruthy();
    expect(steps()[0]).toBe("stopped:Download the memory engine");
    expect(runtime.invoke).not.toHaveBeenCalledWith("memory_models_install");
    expect(calls(invoke, "memory_configure")).toHaveLength(0);
  });

  it("says when this Mac cannot run memory", async () => {
    runtime.invoke.mockResolvedValue({ phase: "unsupported", received: 0, total: 0 });
    setup({ supported: false });
    expect(await screen.findByRole("heading", { name: "Not available on this Mac yet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start automatic memory" })).toBeNull();
  });
});

