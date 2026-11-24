// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ScreenContextClient } from "../screen-context/screenContextClient";
import { MEMORY_MAY_BE_ON_STORAGE_KEY } from "../memory/memoryBeta";
import { useMemoryMarkdownExport } from "../memory/memoryExport";
import { MemorySettings } from "./MemorySettings";

const lease = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
type Options = { recording?: boolean; allowedApps?: string[]; general?: boolean; memoryApps?: string[]; sites?: string[]; enabled?: boolean; keys?: { anthropic: boolean; cloud: boolean }; supported?: boolean; engine?: Record<string, unknown> };
function setup({ recording = true, allowedApps = ["slack"], general = false, memoryApps = [], sites = [], enabled = false, keys = { anthropic: true, cloud: false }, supported = true, engine = {} }: Options = {},
  links: { onOpenAiSettings?: () => void; onOpenScreenRecording?: () => void; onOpenExclusions?: () => void } = {}) {
  let preferences = { enabled, retentionHours: 24, workSites: sites, apps: memoryApps };
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
  it("asks only for which keys exist and turns on with every supported app, without a consent step", async () => {
    const { invoke } = setup();
    const toggle = await memorySwitch();
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(invoke).toHaveBeenCalledWith("memory_get_status", { includeCredentials: true, leaseId: lease });
    expect(screen.queryByRole("checkbox")).toBeNull();
    // Every app and site is read; there is no app or site list to keep.
    expect(screen.getByText(/Reads the visible window of every app and site every 30 seconds/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(toggle);
    await waitFor(async () => expect((await memorySwitch()).getAttribute("aria-checked")).toBe("true"));
    expect(configured(invoke)[0]).toEqual({ acknowledgeExternalText: true, preferences: { enabled: true, retentionHours: 24, workSites: [], apps: [] }, leaseId: lease });
    expect(window.localStorage.getItem(MEMORY_MAY_BE_ON_STORAGE_KEY)).toBe("1");
  });
  it("lists what memory still needs, each with the way to fix it", async () => {
    const openRecording = vi.fn(); const openAi = vi.fn();
    setup({ recording: false, keys: { anthropic: false, cloud: false } }, { onOpenScreenRecording: openRecording, onOpenAiSettings: openAi });
    await screen.findByText("Screen recording is off or paused.");
    expect(screen.getByText("Needs Drifty Cloud (trial or Pro) or your own Anthropic key.")).toBeTruthy();
    expect(screen.queryByText("AI processing")).toBeNull();
    expect(((await memorySwitch()) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Screen recording settings" }));
    expect(openRecording).toHaveBeenCalled();
    const needs = screen.getByText("Needed to turn on").parentElement as HTMLElement;
    fireEvent.click(within(needs).getByRole("button", { name: "Connect key" }));
    expect(openAi).toHaveBeenCalled();
  });
  it("needs no key with Drifty Cloud and says which way memory is processed", async () => {
    setup({ keys: { anthropic: false, cloud: true } });
    await screen.findByText("Drifty Cloud");
    expect(screen.getByText(/Included with Pro/)).toBeTruthy();
    expect(screen.queryByText("Needed to turn on")).toBeNull();
    expect(((await memorySwitch()) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    setup({ keys: { anthropic: true, cloud: false } });
    await screen.findByText("Your Anthropic key");
    // Only one way there, so nothing to pick.
    expect(screen.queryByLabelText("AI processing")).toBeNull();
    expect(screen.getByText("Your connected Anthropic account is charged. Trials and Pro need no key.")).toBeTruthy();
    // What leaves the computer names the screen image, both routes and the on-device search index; no embedding provider.
    fireEvent.click(screen.getByRole("button", { name: "What is sent" }));
    expect(screen.getByText(/Screen text and one image of that screen go to Anthropic's Claude Haiku/)).toBeTruthy();
    expect(screen.getByText(/Drifty Cloud routes it through Drifty, which keeps only usage/)).toBeTruthy();
    expect(screen.getByText(/search index is built on this Mac/)).toBeTruthy();
    expect(screen.queryByText(/OpenRouter/)).toBeNull();
  });
  it("lets the person pick the route when Drifty Cloud and a key are both there", async () => {
    const { invoke } = setup({ enabled: true, keys: { anthropic: true, cloud: true } });
    const route = await screen.findByLabelText("AI processing") as HTMLSelectElement;
    expect(route.value).toBe("cloud");
    fireEvent.change(route, { target: { value: "own" } });
    await waitFor(() => expect(lastConfigured(invoke)).toEqual({ acknowledgeExternalText: true,
      preferences: { enabled: true, retentionHours: 24, workSites: [], apps: [], ownKey: true }, leaseId: lease }));
    await waitFor(() => expect((screen.getByLabelText("AI processing") as HTMLSelectElement).value).toBe("own"));
    // With Pro there, the key's description drops the hint that Pro needs no key.
    expect(screen.getByText("Your connected Anthropic account is charged.")).toBeTruthy();
    // Changing the retention keeps the choice.
    fireEvent.change(screen.getByLabelText("Keep original screens"), { target: { value: "6" } });
    await waitFor(() => expect(lastConfigured(invoke)).toMatchObject({ preferences: { retentionHours: 6, ownKey: true } }));
    cleanup();
    // While memory is off the choice is saved for the next start, without turning it on.
    const off = setup({ keys: { anthropic: true, cloud: true } });
    fireEvent.change(await screen.findByLabelText("AI processing"), { target: { value: "own" } });
    await waitFor(() => expect(lastConfigured(off.invoke)).toMatchObject({ acknowledgeExternalText: false, preferences: { enabled: false, ownKey: true } }));
    await waitFor(() => { const select = screen.getByLabelText("AI processing") as HTMLSelectElement; expect([select.value, select.disabled]).toEqual(["own", false]); });
    fireEvent.change(screen.getByLabelText("AI processing"), { target: { value: "cloud" } });
    await waitFor(() => expect((lastConfigured(off.invoke) as { preferences: Record<string, unknown> }).preferences).not.toHaveProperty("ownKey"));
  });
  it("explains why Drifty Cloud stopped memory", async () => {
    const diagnostics = { phase: "retrying", as_of_ms: Date.now(), last_source_at_ms: null, last_extracted_at_ms: null, next_attempt_at_ms: null,
      facts: 0, running: 0, waiting: 1, exhausted: 0, errors: 1, writes_hour: 1, writes_day: 1, queries_hour: 0,
      writes_hour_limit: 12, writes_day_limit: 60, queries_hour_limit: 30, hour_resets_at_ms: Date.now() + 1000, day_resets_at_ms: Date.now() + 1000 };
    setup({ enabled: true, keys: { anthropic: false, cloud: true }, engine: { diagnostics, route: { kind: "cloud", error: "credits_exhausted", embedding: "ready" } } });
    expect(await screen.findByText("Stopped: Drifty Cloud credits are used up")).toBeTruthy();
    expect(screen.getByText("Drifty Cloud")).toBeTruthy();
    // The processing log is for troubleshooting and stays folded until asked for.
    expect(screen.queryByText(/Request reservations/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show processing log" }));
    expect(screen.getByText(/Request reservations/)).toBeTruthy();
  });
  it("cannot be turned on without a memory engine", async () => {
    setup({ supported: false });
    await screen.findByText("Memory engine");
    expect(((await memorySwitch()) as HTMLButtonElement).disabled).toBe(true);
  });
  it("names what is never read and links to the exclusion list", async () => {
    const openExclusions = vi.fn();
    setup({ enabled: true }, { onOpenExclusions: openExclusions });
    expect(await screen.findByText(/private windows, password managers, Keychain and System Settings are never read/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage exclusions" }));
    expect(openExclusions).toHaveBeenCalled();
  });
  it("passes work sites saved by an earlier version back unchanged", async () => {
    const { invoke } = setup({ enabled: true, sites: ["github.com"] });
    fireEvent.change(await screen.findByLabelText("Keep original screens"), { target: { value: "6" } });
    await waitFor(() => expect(lastConfigured(invoke)).toEqual({ acknowledgeExternalText: true,
      preferences: { enabled: true, retentionHours: 6, workSites: ["github.com"], apps: [] }, leaseId: lease }));
  });
  it("reads every supported app without a choice, also when recording captures the whole screen", async () => {
    const { invoke } = setup({ general: true });
    const toggle = await memorySwitch();
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByLabelText("Slack")).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(lastConfigured(invoke)).toMatchObject({ preferences: { enabled: true, apps: [] }, acknowledgeExternalText: true }));
    // The engine narrows recording itself; the settings page never reconfigures it.
    expect(invoke.mock.calls.some(([name]) => name === "screen_context_configure")).toBe(false);
  });
  it("changes retention in place while on and keeps it local while off", async () => {
    const { invoke } = setup({ enabled: true });
    fireEvent.change(await screen.findByLabelText("Keep original screens"), { target: { value: "6" } });
    await waitFor(() => expect((lastConfigured(invoke) as { preferences: { retentionHours: number } }).preferences.retentionHours).toBe(6));
    cleanup();
    const off = setup();
    fireEvent.change(await screen.findByLabelText("Keep original screens"), { target: { value: "1" } });
    expect(configured(off.invoke)).toHaveLength(0);
  });
  it("deletes everything only after the final confirmation", async () => {
    const { invoke } = setup({ enabled: true });
    fireEvent.click(await screen.findByRole("button", { name: "Delete…" }));
    expect(screen.getByRole("alert").textContent).toContain("Delete all memories, pages, original screens and kept Markdown files for this profile?");
    expect(invoke.mock.calls.some(([name]) => name === "memory_purge")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("memory_purge", { leaseId: lease }));
    // The Markdown copies go too.
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("memory_export_clear", { leaseId: lease }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(window.localStorage.getItem(MEMORY_MAY_BE_ON_STORAGE_KEY)).toBeNull();
  });
  it("shows the page count while on", async () => {
    setup({ enabled: true });
    expect(await screen.findByText(/3 pages/)).toBeTruthy();
  });
  it("keeps Markdown files in its own folder without a switch and opens it once there are files", async () => {
    const { client, invoke } = setup({ enabled: true });
    expect(await screen.findByText(/also saved as a Markdown file/)).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /Markdown/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open folder" })).toBeNull();
    function Exporter() { useMemoryMarkdownExport(client); return null; }
    render(<LocalizationTestProvider language="en"><Exporter /></LocalizationTestProvider>);
    await waitFor(() => expect(invoke.mock.calls.some(([name]) => name === "memory_export_markdown")).toBe(true));
    const written = invoke.mock.calls.find(([name]) => name === "memory_export_markdown")?.[1] as { files: { name: string }[] };
    // Plain file names only; the native side picks the folder.
    expect(written.files.map((file) => file.name)).toEqual(["Juniper release.md"]);
    expect(await screen.findByText(/1 Markdown file$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("memory_export_open", { leaseId: lease }));
  });
  it("does not poll for Markdown files while memory is off", async () => {
    // Someone who opened the beta but never switched memory on: no marker, no gate check yet.
    const { client, invoke } = setup({ enabled: false });
    expect(await screen.findByText("Memory pages")).toBeTruthy();
    function Exporter() { useMemoryMarkdownExport(client); return null; }
    render(<LocalizationTestProvider language="en"><Exporter /></LocalizationTestProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(invoke.mock.calls.some(([name]) => name === "memory_wiki_pages" || name === "memory_export_markdown")).toBe(false);
  });
});
