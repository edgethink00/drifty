// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ScreenCapturePreferences, ScreenContextStatus } from "@drifty/domain";
import { ScreenRecordingDataRow, ScreenRecordingPermissionRow } from "./ScreenContextSettings";
import { ScreenContextClient, type ScreenContextInvoke } from "../screen-context/screenContextClient";
import { openSystemSettingsPane } from "../../lib/api/systemSettingsClient";

vi.mock("../../lib/api/systemSettingsClient", () => ({ openSystemSettingsPane: vi.fn(async () => undefined) }));

const LEASE = "a9db1b29-80fb-4104-9272-46e0845a4774";
const RECORD = "c65b878f-5e63-40c6-9b2d-8a5c444026f0";
const OFF: ScreenCapturePreferences = { enabled: false, replayEnabled: false, visibleTextEnabled: false, ocrEnabled: false, allowedApps: [], intervalSeconds: 10 };
const ON: ScreenCapturePreferences = { enabled: true, replayEnabled: true, visibleTextEnabled: true, ocrEnabled: false, allowedApps: ["textedit", "preview"], intervalSeconds: 10 };
const MAC_APPS = [{ id: "textedit", name: "TextEdit" }, { id: "preview", name: "Preview" }];
const clients: ScreenContextClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.dispose()); vi.mocked(openSystemSettingsPane).mockClear(); });

function fixture({ helperInstalled = true, granted = true, apps = MAC_APPS, initial = OFF, text = "OWNED_PRIVATE_SCREEN_BODY",
  lastFailure = null as ScreenContextStatus["lastFailure"], screenAllowed = false, captureEnabled = undefined as boolean | undefined } = {}) {
  let preferences = initial;
  let paused = false;
  let deleted = false;
  const status = (): ScreenContextStatus => ({ preferences, preferencesInvalid: false, captureEnabled: captureEnabled ?? preferences.enabled,
    helperInstalled, globalPaused: false, ocrSupported: true, supportedApps: apps,
    paused, running: preferences.enabled, preparing: false, accepted: 0, dropped: 0, lastFailure, lastAcceptedAtMs: null });
  const invoke = vi.fn<ScreenContextInvoke>(async (command, args) => {
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") return { leaseId: LEASE, value: { mode: "local", expiresAtMs: Date.now() + 900_000 } };
    if (command === "screen_context_permission_status") return { granted: screenAllowed };
    if (command === "screen_context_get_status") return { leaseId: LEASE, value: status() };
    if (command === "screen_context_request_permission") return { leaseId: LEASE, value: { granted } };
    if (command === "screen_context_configure") {
      preferences = args?.preferences as ScreenCapturePreferences;
      if (args?.resume === true) paused = false;
      return { leaseId: LEASE, value: status() };
    }
    if (command === "screen_context_list_evidence") return { leaseId: LEASE, value: { records: deleted ? [] : [{ id: RECORD,
      observedAtMs: Date.now(), expiresAtMs: Date.now() + 60_000, textSource: "accessibility", textState: "recognized", frameRetained: false }], nextCursor: null } };
    if (command === "screen_context_read_evidence") return { leaseId: LEASE, value: { id: RECORD, observedAtMs: Date.now(), expiresAtMs: Date.now() + 60_000,
      textEvidence: { source: "accessibility", state: "recognized", text }, frameUrl: null } };
    if (command === "screen_context_preview_deletion") return { leaseId: LEASE, value: { recordCount: deleted ? 0 : 1, imageBytes: deleted ? 0 : 2048 } };
    if (command === "screen_context_delete_evidence") { paused = true; deleted = true; return { leaseId: LEASE, value: { removedCount: 1, pendingFiles: 0 } }; }
    throw new Error("unexpected fixture command");
  });
  const client = new ScreenContextClient(invoke, true); client.setAccount(null); clients.push(client);
  const calls = (command: string) => invoke.mock.calls.filter(([name]) => name === command);
  return { client, invoke, calls };
}

it("stays off until the person allows it, then turns on with the defaults and an explicit resume", async () => {
  const { client, calls } = fixture();
  render(<ScreenRecordingPermissionRow client={client} />);
  const allow = await screen.findByRole("button", { name: "Allow" });
  expect(screen.getByText("Optional")).toBeTruthy();
  expect(calls("screen_context_configure")).toHaveLength(0);
  fireEvent.click(allow);
  await screen.findByText("Enabled");
  expect(calls("screen_context_request_permission")[0]?.[1]).toMatchObject({ permission: "screenRecording" });
  const starts = calls("screen_context_configure");
  expect(starts).toHaveLength(1);
  expect(starts[0][1]).toMatchObject({ resume: true, preferences: ON });
  fireEvent.click(screen.getByRole("button", { name: /Turn off/ }));
  await screen.findByRole("button", { name: "Allow" });
  expect(calls("screen_context_configure").slice(-1)[0]?.[1]).toMatchObject({ preferences: { ...ON, enabled: false } });
});

it("keeps recording off when macOS denies the permission and points to System Settings", async () => {
  const { client, calls } = fixture({ granted: false });
  render(<ScreenRecordingPermissionRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
  await screen.findByRole("button", { name: "Open System Settings" });
  expect(screen.getByText(/Still not allowed/)).toBeTruthy();
  // On macOS 27 the denied request may not list Drifty at all, so the drag-to-grant guide comes along.
  expect(openSystemSettingsPane).toHaveBeenCalledWith("screenRecording", { guide: true });
  vi.mocked(openSystemSettingsPane).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Open System Settings" }));
  expect(openSystemSettingsPane).toHaveBeenCalledWith("screenRecording", { guide: true });
  expect(calls("screen_context_configure")).toHaveLength(0);
});

it("opens System Settings without prompting again after Screen Recording was turned off", async () => {
  const { client, calls } = fixture({ initial: ON, lastFailure: "permission" });
  render(<ScreenRecordingPermissionRow client={client} />);
  await screen.findByText("Screen recording was turned off in System Settings, so nothing is being saved.");
  fireEvent.click(screen.getByRole("button", { name: "Reconnect screen recording" }));
  await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("screenRecording", { guide: true }));
  expect(calls("screen_context_request_permission")).toHaveLength(0);
  expect(calls("screen_context_configure")).toHaveLength(0);
});

it("points to Accessibility when Screen Recording is still allowed but saving is refused", async () => {
  const { client, calls } = fixture({ initial: ON, lastFailure: "accessibility_permission", screenAllowed: true });
  render(<ScreenRecordingPermissionRow client={client} />);
  await screen.findByText("Accessibility is turned off in System Settings, so nothing is being saved.");
  fireEvent.click(screen.getByRole("button", { name: "Reconnect screen recording" }));
  // Accessibility is still off and Drifty is not listed yet: the drag-to-grant guide applies.
  await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("accessibility", { guide: true }));
  expect(calls("screen_context_request_permission")).toHaveLength(0);
  expect(calls("screen_context_configure")).toHaveLength(0);
});

it.each([
  { name: "Screen Recording permission is missing", lastFailure: "permission" as const, screenAllowed: false, captureEnabled: true },
  { name: "Accessibility permission is missing", lastFailure: "accessibility_permission" as const, screenAllowed: true, captureEnabled: true },
  { name: "the recorder stopped", lastFailure: null, screenAllowed: true, captureEnabled: false },
])("lets the person turn recording off when $name, without requesting permission", async (state) => {
  const { client, calls } = fixture({ initial: ON, ...state });
  render(<ScreenRecordingPermissionRow client={client} />);
  expect(await screen.findByText("App and site usage time is still recorded when screen recording is off.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Turn off/ }));
  await screen.findByRole("button", { name: "Allow" });
  expect(screen.queryByRole("button", { name: /Turn off/ })).toBeNull();
  expect(calls("screen_context_configure")).toHaveLength(1);
  expect(calls("screen_context_configure")[0][1]).toMatchObject({ preferences: { ...ON, enabled: false } });
  expect(calls("screen_context_request_permission")).toHaveLength(0);
  expect(openSystemSettingsPane).not.toHaveBeenCalled();
});

it("explains that usage tracking continues before screen recording is enabled", async () => {
  const { client, calls } = fixture();
  render(<ScreenRecordingPermissionRow client={client} />);
  await screen.findByRole("button", { name: "Allow" });
  expect(screen.getByText("App and site usage time is still recorded when screen recording is off.")).toBeTruthy();
  expect(calls("screen_context_configure")).toHaveLength(0);
  expect(calls("screen_context_request_permission")).toHaveLength(0);
});

it("keeps Turn off available after a reconnect opens System Settings", async () => {
  const { client, calls } = fixture({ initial: ON, lastFailure: "permission", granted: false });
  render(<ScreenRecordingPermissionRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reconnect screen recording" }));
  await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledTimes(1));
  const settingsCalls = vi.mocked(openSystemSettingsPane).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: /Turn off/ }));
  await waitFor(() => expect(calls("screen_context_configure")).toHaveLength(1));
  await screen.findByRole("button", { name: "Allow" });
  expect(screen.queryByText(/Still not allowed/)).toBeNull();
  expect(calls("screen_context_configure")[0][1]).toMatchObject({ preferences: { ...ON, enabled: false } });
  expect(calls("screen_context_request_permission")).toHaveLength(0);
  expect(openSystemSettingsPane).toHaveBeenCalledTimes(settingsCalls);
});

it("resumes with an existing grant after the retry limit without requesting permission", async () => {
  const { client, calls } = fixture({ initial: ON, lastFailure: "capture_stopped", screenAllowed: true });
  render(<ScreenRecordingPermissionRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reconnect screen recording" }));
  await waitFor(() => expect(calls("screen_context_configure")[0]?.[1]).toMatchObject({ resume: true, preferences: ON }));
  expect(calls("screen_context_request_permission")).toHaveLength(0);
});

it("offers Turn on without a permission request on Windows", async () => {
  const { client, calls } = fixture({ apps: [{ id: "notepad", name: "Notepad" }] });
  render(<ScreenRecordingPermissionRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
  await screen.findByText("Enabled");
  expect(calls("screen_context_request_permission")).toHaveLength(0);
  expect(calls("screen_context_configure")[0]?.[1]).toMatchObject({ resume: true, preferences: { enabled: true, allowedApps: ["notepad"], replayEnabled: true, visibleTextEnabled: true } });
});

it("shows no row and never turns on without the recording component", async () => {
  const { client, calls } = fixture({ helperInstalled: false });
  render(<ScreenRecordingPermissionRow client={client} />);
  await waitFor(() => expect(calls("screen_context_get_status").length).toBeGreaterThan(0));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText("Screen recording")).toBeNull();
  expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  expect(calls("screen_context_configure")).toHaveLength(0);
  render(<ScreenRecordingDataRow client={client} />);
  expect(screen.queryByText("Saved screens")).toBeNull();
});

const chooseRange = (name: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: "Delete range" }));
  fireEvent.click(screen.getByRole("option", { name }));
};
const deleteSummary = () => screen.getByRole("dialog", { name: "Delete screen records" }).querySelector(".screen-recording-delete__note")?.textContent ?? "";

it("keeps the saved-screens row out of Privacy until recording has been used", async () => {
  const { client, calls } = fixture();
  render(<ScreenRecordingDataRow client={client} />);
  await waitFor(() => expect(calls("screen_context_get_status").length).toBeGreaterThan(0));
  expect(screen.queryByText("Saved screens")).toBeNull();
});

it("confirms a bounded screen-only deletion and reports that recording paused", async () => {
  const { client, calls } = fixture({ initial: ON });
  render(<ScreenRecordingDataRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Delete…" }));
  expect(screen.getByRole("dialog", { name: "Delete screen records" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Delete range" }).textContent).toContain("Last hour");
  expect(calls("screen_context_delete_evidence")).toHaveLength(0);
  await waitFor(() => expect(deleteSummary()).toContain("Deletes 1 screen (2 KB)."));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await screen.findByText("Deleted 1. Screen recording is paused.");
  const range = calls("screen_context_delete_evidence")[0]?.[1];
  expect(Number(range?.endMs) - Number(range?.startMs)).toBe(3_600_000);
  expect(calls("tracker_delete_segments")).toHaveLength(0);
  expect(calls("delete_activity_segments")).toHaveLength(0);
});

it("deletes every saved screen only after a second press on All time", async () => {
  const { client, calls } = fixture({ initial: ON });
  render(<ScreenRecordingDataRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Delete…" }));
  chooseRange("All time");
  await screen.findByText("From the first saved screen to now");
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  // Like activity-history deletion, the full wipe is armed by the first press.
  expect(calls("screen_context_delete_evidence")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Click again to confirm" }));
  await screen.findByText("Deleted 1. Screen recording is paused.");
  expect(calls("screen_context_delete_evidence")[0]?.[1]).toMatchObject({ startMs: null, endMs: null });
});

it("waits for a successful estimate and deletes the exact reviewed interval", async () => {
  const { client, invoke, calls } = fixture({ initial: ON });
  const original = invoke.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  invoke.mockImplementation((command, args) => command === "screen_context_preview_deletion"
    ? new Promise(resolve => { finish = resolve; }) : original(command, args));
  render(<ScreenRecordingDataRow client={client} />);
  await screen.findByRole("button", { name: "Delete…" });
  expect(calls("screen_context_preview_deletion")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
  await waitFor(() => expect(calls("screen_context_preview_deletion")).toHaveLength(1));
  const confirm = screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(calls("screen_context_delete_evidence")).toHaveLength(0);
  await act(async () => finish({ leaseId: LEASE, value: { recordCount: 1, imageBytes: 2048 } }));
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  await screen.findByText("Deleted 1. Screen recording is paused.");
  const read = calls("screen_context_preview_deletion")[0][1]!;
  expect(calls("screen_context_delete_evidence")[0][1]).toMatchObject({ startMs: read.startMs, endMs: read.endMs });
});

it("ignores a late estimate for another range and clears estimates on account change", async () => {
  const { client, invoke } = fixture({ initial: ON });
  const original = invoke.getMockImplementation()!;
  const finishes: ((value: unknown) => void)[] = [];
  invoke.mockImplementation((command, args) => command === "screen_context_preview_deletion"
    ? new Promise(resolve => { finishes.push(resolve); }) : original(command, args));
  render(<ScreenRecordingDataRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Delete…" }));
  await waitFor(() => expect(finishes).toHaveLength(1));
  chooseRange("All time");
  await waitFor(() => expect(finishes).toHaveLength(2));
  await act(async () => finishes[1]({ leaseId: LEASE, value: { recordCount: 3, imageBytes: 4096 } }));
  await waitFor(() => expect(deleteSummary()).toContain("Deletes 3 screens (4 KB)."));
  await act(async () => finishes[0]({ leaseId: LEASE, value: { recordCount: 1, imageBytes: 2048 } }));
  expect(deleteSummary()).toContain("Deletes 3 screens (4 KB).");
  act(() => client.setAccount(undefined));
  expect(screen.queryByText("3 screens")).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
});

it("keeps deletion disabled after an estimate failure and for an empty range", async () => {
  const { client, invoke, calls } = fixture({ initial: ON });
  const original = invoke.getMockImplementation()!;
  let fail = true;
  invoke.mockImplementation((command, args) => command === "screen_context_preview_deletion"
    ? fail ? Promise.reject("screen_context_storage_full") : Promise.resolve({ leaseId: LEASE, value: { recordCount: 0, imageBytes: 0 } })
    : original(command, args));
  render(<ScreenRecordingDataRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Delete…" }));
  await screen.findByText("Couldn't check");
  expect((screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement).disabled).toBe(true);
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("No screens in this period.");
  expect((screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement).disabled).toBe(true);
  expect(calls("screen_context_delete_evidence")).toHaveLength(0);
});

it("opens recent screens and clears their text when the account changes", async () => {
  const { client } = fixture({ initial: ON });
  render(<ScreenRecordingDataRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "View" }));
  expect(await screen.findByRole("heading", { name: "Recent screens" })).toBeTruthy();
  await screen.findByText("OWNED_PRIVATE_SCREEN_BODY");
  act(() => client.setAccount(undefined));
  expect(screen.queryByText("OWNED_PRIVATE_SCREEN_BODY")).toBeNull();
});

it.each(["\r", "\r\n", "\n"])("keeps saved text paragraphs visible with %j line endings", async (lineEnding) => {
  const lines = ["Draft only", "검토 중인 문서", "Do not send or deploy"];
  const { client } = fixture({ initial: ON, text: lines.join(lineEnding) });
  render(<ScreenRecordingDataRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "View" }));
  const panel = await screen.findByRole("complementary", { name: "Screen text" });
  await waitFor(() => expect(panel.querySelector("pre")?.textContent).toBe(lines.join("\n")));
});

it("closes recent screens on a policy change without reporting a failure, then reads under the new generation", async () => {
  const { client, invoke } = fixture({ initial: ON });
  const original = invoke.getMockImplementation()!;
  let finishOldRead!: (value: unknown) => void;
  const oldRead = new Promise<unknown>((resolve) => { finishOldRead = resolve; });
  let reads = 0;
  invoke.mockImplementation((command, args) => command === "screen_context_list_evidence" && ++reads === 1 ? oldRead : original(command, args));
  render(<ScreenRecordingDataRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "View" }));
  await waitFor(() => expect(reads).toBe(1));
  act(() => { client.invalidate(); client.credentialsReady(); });
  await act(async () => { finishOldRead({ leaseId: LEASE, value: { records: [], nextCursor: null } }); await oldRead; });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/No screens saved yet/)).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "View" }));
  await screen.findByText("OWNED_PRIVATE_SCREEN_BODY");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("still reports an actual read failure in the viewer", async () => {
  const { client, invoke } = fixture({ initial: ON });
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) => command === "screen_context_list_evidence" ? Promise.reject("screen_context_storage_full") : original(command, args));
  render(<ScreenRecordingDataRow client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "View" }));
  expect((await screen.findByRole("alert")).textContent).toContain("The screen could not be loaded.");
});
