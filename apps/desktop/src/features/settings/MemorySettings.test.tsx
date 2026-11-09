// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ScreenContextClient } from "../screen-context/screenContextClient";
import { MEMORY_MAY_BE_ON_STORAGE_KEY } from "../memory/memoryBeta";
import { useMemoryMarkdownExport } from "../memory/memoryExport";
import { MemorySettings, workSites } from "./MemorySettings";

const lease = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
type Options = { recording?: boolean; allowedApps?: string[]; general?: boolean; memoryApps?: string[]; enabled?: boolean; keys?: { anthropic: boolean; cloud: boolean }; supported?: boolean; engine?: Record<string, unknown> };
function setup({ recording = true, allowedApps = ["slack"], general = false, memoryApps = [], enabled = false, keys = { anthropic: true, cloud: false }, supported = true, engine = {} }: Options = {},
  links: { onOpenMemoryTab?: () => void; onOpenAiSettings?: () => void; onOpenScreenRecording?: () => void } = {}) {
  let preferences = { enabled, retentionHours: 24, workSites: [] as string[], apps: memoryApps };
  let apps = [...allowedApps];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    let value: unknown;
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") value = { mode: "local", expiresAtMs: Date.now() + 900000 };
    else if (command === "memory_get_status") value = { supported, preferences, ...(args?.includeCredentials ? { credentials: keys } : {}),
      status: preferences.enabled ? { active: true, wiki: { pages: 3 }, ...engine } : null };
    else if (command === "screen_context_get_status") value = {
      preferences: { ...(general ? { scope: "active_display_scene" } : {}), enabled: recording, replayEnabled: true, visibleTextEnabled: false, ocrEnabled: false, allowedApps: general ? [] : apps, intervalSeconds: 10 },
      preferencesInvalid: false, captureEnabled: true, helperInstalled: true, globalPaused: false, ocrSupported: true,
      supportedApps: [{ id: "slack", name: "Slack" }, { id: "discord", name: "Discord" }, { id: "chrome", name: "Google Chrome" }],
      paused: false, running: true, preparing: false, accepted: 0, dropped: 0, lastFailure: null, lastAcceptedAtMs: null,
    };
    else if (command === "memory_configure") { preferences = args?.preferences as typeof preferences; value = { saved: true }; }
    else if (command === "memory_purge") { preferences = { ...preferences, enabled: false }; value = { purged: true }; }
    else if (command === "screen_context_configure") { apps = (args?.preferences as { allowedApps: string[] }).allowedApps; value = null; }
    else if (command === "memory_wiki_pages") value = { pages: [{ id: "aaaaaaaaaaa1", title: "Juniper release", kind: "project", updated_at_ms: 1, updated_at_utc: "x",
      lines: [{ id: "bbbbbbbbbbb1", text: "Moved to Monday.", status: "current", app: "com.tinyspeck.slackmacgap", observed_at_ms: 1, observed_at_utc: "x", created_at_ms: 1, original_available: false, original_source_ids: [] }] }] };
    else if (command === "memory_export_markdown") value = { written: (args?.files as unknown[]).length, removed: 0, skipped: 0 };
    else if (command === "memory_export_open" || command === "memory_export_clear") value = command === "memory_export_open" ? true : { removed: 1 };
    else throw new Error(command);
    return { leaseId: lease, value };
  });
  const client = new ScreenContextClient(invoke, true);
  client.setAccount(null);
  render(<LocalizationTestProvider language="en"><MemorySettings client={client} {...links} /></LocalizationTestProvider>);
  return { client, invoke };
}
const memorySwitch = () => screen.findByRole("switch", { name: "Remember what I see while working" });
const configured = (invoke: ReturnType<typeof setup>["invoke"]) => invoke.mock.calls.filter(([name]) => name === "memory_configure").map(([, args]) => args);
const lastConfigured = (invoke: ReturnType<typeof setup>["invoke"]) => { const all = configured(invoke); return all[all.length - 1]; };
beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("Settings › Automatic memory", () => {
  it("asks only for which keys exist and turns on after explicit consent, which an account change clears", async () => {
    const { client, invoke } = setup();
    const toggle = await memorySwitch();
    await screen.findByLabelText("Slack");
    expect(invoke).toHaveBeenCalledWith("memory_get_status", { includeCredentials: true, leaseId: lease });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    const consent = screen.getByLabelText("Allow sending the text on screens of the chosen apps to AI services to organize memory.");
    fireEvent.click(consent);
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    await act(async () => client.setAccount(null));
    await waitFor(() => expect((screen.getByLabelText("Allow sending the text on screens of the chosen apps to AI services to organize memory.") as HTMLInputElement).checked).toBe(false));
    expect(configured(invoke)).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("Allow sending the text on screens of the chosen apps to AI services to organize memory."));
    fireEvent.click(await memorySwitch());
    await waitFor(async () => expect((await memorySwitch()).getAttribute("aria-checked")).toBe("true"));
    expect(configured(invoke)[0]).toEqual({ acknowledgeExternalText: true, preferences: { enabled: true, retentionHours: 24, workSites: [], apps: ["slack"] }, leaseId: lease });
    expect(window.localStorage.getItem(MEMORY_MAY_BE_ON_STORAGE_KEY)).toBe("1");
  });
  it("lists what memory still needs, each with the way to fix it", async () => {
    const openRecording = vi.fn(); const openAi = vi.fn();
    setup({ recording: false, keys: { anthropic: false, cloud: false } }, { onOpenScreenRecording: openRecording, onOpenAiSettings: openAi });
    await screen.findByText("Screen recording is off or paused.");
    expect(screen.getByText("Needs Drifty Cloud (trial or Pro) or your own Anthropic key.")).toBeTruthy();
    expect(screen.queryByText("AI processing")).toBeNull();
    fireEvent.click(screen.getByLabelText("Allow sending the text on screens of the chosen apps to AI services to organize memory."));
    expect(((await memorySwitch()) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Screen recording settings" }));
    expect(openRecording).toHaveBeenCalled();
    const needs = screen.getByText("Needed to turn on").parentElement as HTMLElement;
    fireEvent.click(within(needs).getByRole("button", { name: "Connect key" }));
    expect(openAi).toHaveBeenCalled();
  });
  it("needs no key with Drifty Cloud and says which way memory is processed", async () => {
    setup({ keys: { anthropic: false, cloud: true } });
    await screen.findByText("Drifty Cloud · included with Pro");
    expect(screen.queryByText("Needed to turn on")).toBeNull();
    fireEvent.click(screen.getByLabelText("Allow sending the text on screens of the chosen apps to AI services to organize memory."));
    expect(((await memorySwitch()) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    setup({ keys: { anthropic: true, cloud: false } });
    await screen.findByText("Your Anthropic key");
    // What leaves the computer names both routes and the on-device search index; no embedding provider.
    fireEvent.click(screen.getByRole("button", { name: "What is sent" }));
    expect(screen.getByText(/passes through Drifty Cloud, which keeps only usage/)).toBeTruthy();
    expect(screen.getByText(/search index is built on this Mac/)).toBeTruthy();
    expect(screen.queryByText(/OpenRouter/)).toBeNull();
  });
  it("explains why Drifty Cloud stopped memory", async () => {
    const diagnostics = { phase: "retrying", as_of_ms: Date.now(), last_source_at_ms: null, last_extracted_at_ms: null, next_attempt_at_ms: null,
      facts: 0, running: 0, waiting: 1, exhausted: 0, errors: 1, writes_hour: 1, writes_day: 1, queries_hour: 0,
      writes_hour_limit: 12, writes_day_limit: 60, queries_hour_limit: 30, hour_resets_at_ms: Date.now() + 1000, day_resets_at_ms: Date.now() + 1000 };
    setup({ enabled: true, keys: { anthropic: false, cloud: true }, engine: { diagnostics, route: { kind: "cloud", error: "credits_exhausted", embedding: "ready" } } });
    expect(await screen.findByText("Stopped: Drifty Cloud credits are used up")).toBeTruthy();
    expect(screen.getByText("Drifty Cloud · included with Pro")).toBeTruthy();
  });
  it("cannot be turned on without a memory engine", async () => {
    setup({ supported: false });
    await screen.findByText("This build has no memory engine, so memory can't be turned on.");
    expect(((screen.getByLabelText("Allow sending the text on screens of the chosen apps to AI services to organize memory.")) as HTMLInputElement).disabled).toBe(true);
  });
  it("offers work sites only with a browser chosen, normalizes them and applies changes in place while on", async () => {
    setup({ allowedApps: ["slack"] });
    await screen.findByLabelText("Slack");
    expect(screen.queryByLabelText("Work sites in browsers")).toBeNull();
    cleanup();
    const { invoke } = setup({ allowedApps: ["chrome"], enabled: true });
    const input = await screen.findByLabelText("Work sites in browsers");
    fireEvent.change(input, { target: { value: "https://www.GitHub.com/org/repo, claude.ai" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(lastConfigured(invoke)).toEqual({ acknowledgeExternalText: true, preferences: { enabled: true, retentionHours: 24, workSites: ["github.com", "claude.ai"], apps: ["chrome"] }, leaseId: lease }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove github.com" }));
    await waitFor(() => expect((lastConfigured(invoke) as { preferences: { workSites: string[] } }).preferences.workSites).toEqual(["claude.ai"]));
  });
  it("keeps its own apps when recording captures the whole screen and changes them in place while on", async () => {
    const { invoke } = setup({ general: true });
    const consent = await screen.findByLabelText("Allow sending the text on screens of the chosen apps to AI services to organize memory.");
    fireEvent.click(consent);
    // General recording has no app list; memory needs one before it can turn on.
    expect(((await memorySwitch()) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Discord"));
    expect(invoke.mock.calls.some(([name]) => name === "screen_context_configure")).toBe(false);
    fireEvent.click(await memorySwitch());
    await waitFor(() => expect(lastConfigured(invoke)).toMatchObject({ preferences: { enabled: true, apps: ["discord"] } }));
    fireEvent.click(await screen.findByLabelText("Slack"));
    await waitFor(() => expect(lastConfigured(invoke)).toMatchObject({ preferences: { enabled: true, apps: ["discord", "slack"] } }));
    expect(invoke.mock.calls.some(([name]) => name === "screen_context_configure")).toBe(false);
    expect(screen.getByText(/While memory is on, screen recording also saves only these apps\./)).toBeTruthy();
    cleanup();
    // The last app cannot be removed while memory is on.
    setup({ general: true, enabled: true, memoryApps: ["slack"] });
    expect(((await screen.findByLabelText("Slack")) as HTMLInputElement).disabled).toBe(true);
  });
  it("normalizes work site names to the tracker's host form", () => {
    expect(workSites("HTTP://Mail.Google.com/u/0 , mail.google.com\n\n.example. https://x.y:8443/a")).toEqual(["mail.google.com", "x.y"]);
    expect(workSites(Array.from({ length: 40 }, (_, i) => "s" + i + ".example").join(" "))).toHaveLength(32);
  });
  it("changes retention in place while on and keeps it local while off", async () => {
    const { invoke } = setup({ enabled: true });
    fireEvent.change(await screen.findByLabelText("Original screens and memory text"), { target: { value: "6" } });
    await waitFor(() => expect((lastConfigured(invoke) as { preferences: { retentionHours: number } }).preferences.retentionHours).toBe(6));
    cleanup();
    const off = setup();
    fireEvent.change(await screen.findByLabelText("Original screens and memory text"), { target: { value: "1" } });
    expect(configured(off.invoke)).toHaveLength(0);
  });
  it("deletes everything only after the final confirmation", async () => {
    const { invoke } = setup({ enabled: true });
    fireEvent.click(await screen.findByRole("button", { name: "Delete everything…" }));
    expect(screen.getByRole("alert").textContent).toContain("Delete all memories, pages, original screens and kept Markdown files for this profile?");
    expect(invoke.mock.calls.some(([name]) => name === "memory_purge")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("memory_purge", { leaseId: lease }));
    // The Markdown copies go too.
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("memory_export_clear", { leaseId: lease }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(window.localStorage.getItem(MEMORY_MAY_BE_ON_STORAGE_KEY)).toBeNull();
  });
  it("links to the Memory page and shows the page count while on", async () => {
    const open = vi.fn();
    setup({ enabled: true }, { onOpenMemoryTab: open });
    expect(await screen.findByText(/3 pages/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage in Work memory" }));
    expect(open).toHaveBeenCalled();
  });
  it("keeps Markdown files in its own folder without a switch and opens it once there are files", async () => {
    const { client, invoke } = setup({ enabled: true });
    expect(await screen.findByText("Markdown files")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /Markdown/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open folder" })).toBeNull();
    function Exporter() { useMemoryMarkdownExport(client); return null; }
    render(<LocalizationTestProvider language="en"><Exporter /></LocalizationTestProvider>);
    await waitFor(() => expect(invoke.mock.calls.some(([name]) => name === "memory_export_markdown")).toBe(true));
    const written = invoke.mock.calls.find(([name]) => name === "memory_export_markdown")?.[1] as { files: { name: string }[] };
    // Plain file names only; the native side picks the folder.
    expect(written.files.map((file) => file.name)).toEqual(["Juniper release.md"]);
    expect(await screen.findByText(/1 file$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("memory_export_open", { leaseId: lease }));
  });
});
