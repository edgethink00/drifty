// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActivityCardDetailRun, ActivitySegment } from "@drifty/domain";
import { WeekActivityInspector, type ActivityInspectorEvent } from "../dashboard/WeekActivityInspector";
import { ActivityInspectionProvider, useActivityInspection } from "../dashboard/ActivityInspectionContext";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ActivityScreenPreview } from "./ActivityScreenPreview";
import { ScreenEvidenceContext } from "./ScreenEvidenceContext";
import { ScreenContextClient, type ScreenContextInvoke } from "./screenContextClient";

const LEASE = "a9db1b29-80fb-4104-9272-46e0845a4774";
const INSTANCE = "5f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const BASE = new Date(2026, 10, 3, 10, 0, 0).getTime();
const at = (seconds: number) => BASE + seconds * 1000;
const id = (index: number) => "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0");
const selection = { recordIds: ["1"], windows: [[at(0), at(600)] as const] };
const clients: ScreenContextClient[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 3, 11, 0, 0));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.dispose());
  vi.useRealTimers();
  window.localStorage.clear();
  document.querySelectorAll("[data-replay-anchor]").forEach((node) => node.remove());
});

/** Saved screens with images, at the given seconds after 10:00, listed 20 to a page within the asked windows. */
function fixture(seconds: readonly number[], { pageMs = 0 }: { readonly pageMs?: number } = {}) {
  const invoke = vi.fn<ScreenContextInvoke>(async (command, args) => {
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") return { leaseId: LEASE, value: { mode: "local", expiresAtMs: Date.now() + 900_000 } };
    if (command === "screen_context_list_activity_evidence") {
      if (pageMs > 0) await new Promise((resolve) => setTimeout(resolve, pageMs));
      const windows = (args?.windows ?? []) as readonly (readonly [number, number])[];
      const listed = seconds.map((second, index) => ({ second, index }))
        .filter(({ second }) => windows.some(([start, end]) => at(second) >= start && at(second) < end));
      const offset = (args?.cursor as { revision: number } | null)?.revision ?? 0;
      const page = listed.slice(offset, offset + 20);
      const last = page[page.length - 1];
      return { leaseId: LEASE, value: { records: page.map(({ second, index }) => ({
        id: id(index), observedAtMs: at(second), expiresAtMs: Date.now() + 3_600_000, textSource: "none", textState: "not_requested", frameRetained: true,
      })), nextCursor: offset + 20 < listed.length && last
        ? { instance: INSTANCE, revision: offset + 20, observedAtMs: at(last.second), id: id(last.index) } : null } };
    }
    if (command === "screen_context_read_evidence") {
      const index = seconds.findIndex((_, position) => id(position) === args?.recordId);
      return { leaseId: LEASE, value: { id: args?.recordId, observedAtMs: at(seconds[index]), expiresAtMs: Date.now() + 3_600_000,
        textEvidence: { source: "none", state: "not_requested", text: "" }, frameUrl: PNG } };
    }
    if (command === "screen_context_get_status") {
      return { leaseId: LEASE, value: { preferences: { enabled: true, replayEnabled: true, visibleTextEnabled: true, ocrEnabled: false, allowedApps: ["textedit"], intervalSeconds: 10 },
        preferencesInvalid: false, captureEnabled: true, helperInstalled: true, globalPaused: false, ocrSupported: true, supportedApps: [{ id: "textedit", name: "TextEdit" }],
        paused: false, running: true, preparing: false, accepted: seconds.length, dropped: 0, lastFailure: null, lastAcceptedAtMs: Date.now() } };
    }
    throw new Error("Unexpected command " + command);
  });
  const client = new ScreenContextClient(invoke, true);
  client.setAccount(null);
  void client.connect().catch(() => undefined);
  clients.push(client);
  return { client, invoke };
}
const readIds = (invoke: ReturnType<typeof fixture>["invoke"]) =>
  invoke.mock.calls.filter(([name]) => name === "screen_context_read_evidence").map(([, args]) => args?.recordId);
async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function ready() {
  for (let pass = 0; pass < 6; pass += 1) await settle();
}
const slider = () => screen.getByRole("slider", { name: "Saved times" });
/** A mouse pointer over the screen (jsdom has no PointerEvent with a pointer type). */
function pointAt(element: HTMLElement, clientX: number) {
  const event = new MouseEvent("pointermove", { bubbles: true, clientX, clientY: 50 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  act(() => { element.dispatchEvent(event); });
}

function InspectionPanel() {
  const { registerPanel } = useActivityInspection();
  return <div ref={registerPanel} />;
}

it("plays an activity's saved screens in place at 20x and stops on the last one", async () => {
  const { client, invoke } = fixture([0, 10, 20, 30]);
  const { container } = render(<LocalizationTestProvider language="en">
    <ActivityScreenPreview client={client} selection={selection} mode="preview" onOpen={() => {}} />
  </LocalizationTestProvider>);
  await ready();
  // Before it plays, the middle screen stands for the activity.
  expect(readIds(invoke)).toEqual([id(1)]);
  expect(invoke.mock.calls.filter(([name]) => name === "screen_context_read_evidence")
    .every(([, args]) => JSON.stringify(args?.recordIds) === JSON.stringify(selection.recordIds)
      && JSON.stringify(args?.windows) === JSON.stringify(selection.windows))).toBe(true);
  expect(container.querySelector(".screen-player__screen img")?.getAttribute("src")).toBe(PNG);
  expect(container.querySelector(".screen-player__now")?.textContent).toBe("Screens from this time");

  fireEvent.click(screen.getByRole("button", { name: "Play the saved screens" }));
  await settle();
  // Playing starts from the first screen; each ten-second screen shows for half a second.
  expect(slider().getAttribute("aria-valuetext")).toBe("10:00:00");
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  await settle(500);
  expect(slider().getAttribute("aria-valuetext")).toBe("10:00:10");
  await settle(500);
  await settle(500);
  expect(slider().getAttribute("aria-valuetext")).toBe("10:00:30");
  await settle(500);
  expect(screen.getByRole("button", { name: "Play the saved screens" })).toBeTruthy();
  expect(slider().getAttribute("aria-valuetext")).toBe("10:00:30");
  // It read the screens ahead of showing them, each once.
  expect([...readIds(invoke)].sort()).toEqual([id(0), id(1), id(2), id(3)]);
});

it("previews the screen under the pointer, while a press still plays from the first screen and then resumes", async () => {
  const { client } = fixture([0, 10, 20, 30, 40]);
  const { container } = render(<LocalizationTestProvider language="en">
    <ActivityScreenPreview client={client} selection={selection} mode="preview" onOpen={() => {}} />
  </LocalizationTestProvider>);
  await ready();
  const screenButton = screen.getByRole("button", { name: "Play the saved screens" });
  screenButton.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 112, right: 200, bottom: 112, x: 0, y: 0, toJSON: () => ({}) });
  // Pointing at three quarters previews that screen and its time; the play mark stays.
  pointAt(screenButton, 150);
  await settle();
  expect(container.querySelector(".screen-player__now")?.textContent).toBe("10:00:30");
  expect(container.querySelector(".screen-player__disc")).not.toBeNull();
  // The press in the middle plays from the first screen.
  fireEvent.click(screenButton);
  await settle();
  expect(slider().getAttribute("aria-valuetext")).toBe("10:00:00");
  await settle(500);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  await settle();
  expect(slider().getAttribute("aria-valuetext")).toBe("10:00:10");
  // After a pause, pointing elsewhere and pressing resumes where it paused.
  pointAt(screenButton, 190);
  fireEvent.click(screen.getByRole("button", { name: "Play the saved screens" }));
  await settle();
  expect(slider().getAttribute("aria-valuetext")).toBe("10:00:10");
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
});

it("cycles the speed through 40x and 60x and keeps it for the next replay", async () => {
  const { client } = fixture([0, 10, 20, 30, 40]);
  render(<LocalizationTestProvider language="en">
    <ActivityScreenPreview client={client} selection={selection} mode="preview" onOpen={() => {}} />
  </LocalizationTestProvider>);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Playback speed, 20x" }));
  expect(screen.getByRole("button", { name: "Playback speed, 40x" }).textContent).toBe("40x");
  expect(window.localStorage.getItem("drifty.screenReplaySpeed.v1")).toBe("40");
  fireEvent.click(screen.getByRole("button", { name: "Play the saved screens" }));
  await settle(250);
  expect(slider().getAttribute("aria-valuetext")).toBe("10:00:10");
  cleanup();

  const again = fixture([0, 10, 20]);
  render(<LocalizationTestProvider language="en">
    <ActivityScreenPreview client={again.client} selection={selection} mode="preview" onOpen={() => {}} />
  </LocalizationTestProvider>);
  await ready();
  expect(screen.getByRole("button", { name: "Playback speed, 40x" })).toBeTruthy();
});

it("plays a Details line from its first screen, marks it, and carries the replay into the larger viewer and back", async () => {
  const { client } = fixture([0, 10, 20, 300, 310, 320]);
  const anchor = document.createElement("button");
  anchor.dataset.replayAnchor = "true";
  document.body.append(anchor);
  const runs: ActivityCardDetailRun[] = [
    { label: "First draft", kind: "activity", seconds: 60, startMs: at(0), endMs: at(60), totalSeconds: 60, segmentIds: ["1"] },
    { label: "notes.example", kind: "app", seconds: 230, startMs: at(60), endMs: at(290), totalSeconds: 230, segmentIds: ["1"] },
    { label: "Second draft", kind: "activity", seconds: 310, startMs: at(290), endMs: at(600), totalSeconds: 310, segmentIds: ["1"] },
  ];
  const segments: ActivitySegment[] = [{ id: "1", startedAt: new Date(at(0)).toISOString(), endedAt: new Date(at(600)).toISOString(),
    durationSeconds: 600, appName: "TextEdit", source: "accessibility", platform: "macos" }];
  const event: ActivityInspectorEvent = { id: "owned-log", surface: "flow", segmentIds: ["1"], appName: "TextEdit", category: "workspace",
    productivity: "focus", startLabel: "10:00", endLabel: "10:10", identities: [], hasMixedCategory: false, hasMixedProductivity: false };
  const { container } = render(<LocalizationTestProvider language="en"><ScreenEvidenceContext.Provider value={client}>
    <ActivityInspectionProvider options={{ presentation: "panel", hover: "off" }} scopeKey="owned-log" onRequestOpen={() => {}}>
      <InspectionPanel />
      <WeekActivityInspector event={event} segments={segments} screenEvidenceSegments={segments} detailLog={() => ({ runs, recordedSeconds: 600 })}
        logStretch={{ startMs: at(0), endMs: at(600), segmentIds: ["1"] }} appIcons={{}} anchorElement={anchor} onClose={() => {}} />
    </ActivityInspectionProvider>
  </ScreenEvidenceContext.Provider></LocalizationTestProvider>);
  await ready();
  // A line with no saved screens stays plain text; the others play.
  expect(screen.queryByRole("button", { name: /notes\.example/ })).toBeNull();
  expect(screen.getByText("notes.example")).toBeTruthy();
  // Each line with screens is marked on the track after the first.
  expect(container.querySelectorAll(".screen-player__tick")).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Play the screens from 10:04 · Second draft" }));
  await settle();
  expect(slider().getAttribute("aria-valuetext")).toBe("10:05:00");
  expect(screen.getByRole("button", { name: /Second draft/ }).getAttribute("aria-current")).toBe("true");
  expect(screen.getByRole("button", { name: /First draft/ }).getAttribute("aria-current")).toBeNull();
  await settle(500);
  expect(slider().getAttribute("aria-valuetext")).toBe("10:05:10");

  fireEvent.click(screen.getByRole("button", { name: "See larger" }));
  await ready();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(document.querySelector(".screen-replay__position")?.textContent).toContain("5 / 6");
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  await settle(500);
  expect(document.querySelector(".screen-replay__position")?.textContent).toContain("6 / 6");
  await settle(500);
  expect(screen.getByRole("button", { name: "Play the saved screens" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await ready();
  expect(screen.queryByRole("dialog")).toBeNull();
  // Back in the panel, the replay waits on the screen the viewer reached.
  expect(slider().getAttribute("aria-valuetext")).toBe("10:05:20");
  expect(screen.getByRole("button", { name: "Play the saved screens" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Second draft/ }).getAttribute("aria-current")).toBe("true");
});

it("keeps screens without images behind the viewer entry", async () => {
  const invoke = vi.fn<ScreenContextInvoke>(async (command) => {
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") return { leaseId: LEASE, value: { mode: "local", expiresAtMs: Date.now() + 900_000 } };
    if (command === "screen_context_list_activity_evidence") {
      return { leaseId: LEASE, value: { nextCursor: null, records: [0, 10].map((second, index) => ({
        id: id(index), observedAtMs: at(second), expiresAtMs: Date.now() + 3_600_000, textSource: "accessibility", textState: "recognized", frameRetained: false,
      })) } };
    }
    throw new Error("Unexpected command " + command);
  });
  const client = new ScreenContextClient(invoke, true);
  client.setAccount(null);
  void client.connect().catch(() => undefined);
  clients.push(client);
  const opened = vi.fn();
  render(<LocalizationTestProvider language="en">
    <ActivityScreenPreview client={client} selection={selection} mode="preview" onOpen={opened} />
  </LocalizationTestProvider>);
  await ready();
  expect(screen.queryByRole("button", { name: "Play the saved screens" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^See the screen again/ }));
  expect(opened).toHaveBeenCalledWith(null);
  expect(invoke.mock.calls.some(([name]) => name === "screen_context_read_evidence")).toBe(false);
});
it("takes the replay's place from the first page of a long activity, then fills it without moving", async () => {
  const { client } = fixture(Array.from({ length: 45 }, (_, index) => index * 10), { pageMs: 50 });
  const { container } = render(<LocalizationTestProvider language="en">
    <ActivityScreenPreview client={client} selection={selection} mode="preview" onOpen={() => {}} />
  </LocalizationTestProvider>);
  await ready();
  // Nothing is known yet, so no space is taken.
  expect(container.querySelector(".screen-player-space")).toBeNull();
  await settle(50);
  // The first page shows the activity kept screens: the space opens smoothly in the player's shape.
  const space = container.querySelector(".screen-player-space");
  expect(space?.getAttribute("data-space")).toBe("opening");
  expect(container.querySelector(".screen-player--pending .screen-player__track")).not.toBeNull();
  await settle(50);
  await settle(50);
  await ready();
  // The rest fills the same space.
  expect(container.querySelector(".screen-player-space")).toBe(space);
  expect(container.querySelector(".screen-player--pending")).toBeNull();
  expect(container.querySelector(".screen-player__meta")?.textContent).toContain("45 screens");
});

it("shows an activity opened before at once, and reads it again behind the replay", async () => {
  const { client, invoke } = fixture([0, 10, 20, 30]);
  const lists = () => invoke.mock.calls.filter(([name]) => name === "screen_context_list_activity_evidence").length;
  const view = () => <LocalizationTestProvider language="en">
    <ActivityScreenPreview client={client} selection={selection} mode="preview" onOpen={() => {}} />
  </LocalizationTestProvider>;
  const first = render(view());
  await ready();
  first.unmount();
  expect(lists()).toBe(1);

  const { container } = render(view());
  // Already in the first render: no space opening, nothing pushed down.
  expect(screen.getByRole("button", { name: "Play the saved screens" })).toBeTruthy();
  expect(container.querySelector(".screen-player-space")?.hasAttribute("data-space")).toBe(false);
  await ready();
  expect(lists()).toBe(2);
  expect(container.querySelector(".screen-player__meta")?.textContent).toContain("4 screens");
});

it("keeps the replay's space for the next activity while it is asked about, and closes it when that one kept none", async () => {
  const { client } = fixture([0, 10, 20, 30], { pageMs: 30 });
  const later = { recordIds: ["1"], windows: [[at(1200), at(1800)] as const] };
  const view = (chosen: typeof selection) => <LocalizationTestProvider language="en">
    <ActivityScreenPreview key={JSON.stringify(chosen)} client={client} selection={chosen} mode="preview" onOpen={() => {}} />
  </LocalizationTestProvider>;
  const { container, rerender } = render(view(selection));
  await ready();
  await settle(30);
  await ready();
  expect(screen.getByRole("button", { name: "Play the saved screens" })).toBeTruthy();

  // The next activity's detail replaces this one: the space stays, empty, while it is asked about.
  rerender(view(later));
  expect(container.querySelector(".screen-player-space")?.hasAttribute("data-space")).toBe(false);
  expect(container.querySelector(".screen-player--pending")).not.toBeNull();
  await settle(30);
  await ready();
  // It kept no screens: the space closes smoothly, then leaves.
  expect(container.querySelector(".screen-player-space")?.getAttribute("data-space")).toBe("closing");
  await settle(180);
  expect(container.querySelector(".screen-player-space")).toBeNull();
});


it("keeps an inline replay visible beyond the native five-second watch and stops renewal on close", async () => {
  const { client, invoke } = fixture([0, 10, 20]);
  let renewedAt = Date.now();
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args) => {
    const result = await original(command, args);
    if (command === "screen_context_get_status") renewedAt = Date.now();
    return result;
  });
  const watchdog = setInterval(() => {
    if (Date.now() - renewedAt >= 5000) client.invalidate();
  }, 1000);
  const { unmount } = render(<LocalizationTestProvider language="en">
    <ActivityScreenPreview client={client} selection={selection} mode="preview" onOpen={() => {}} />
  </LocalizationTestProvider>);
  await ready();
  await settle(8000);
  expect(screen.queryByRole("button", { name: "Play the saved screens" })).not.toBeNull();
  const renewals = invoke.mock.calls.filter(([name]) => name === "screen_context_get_status").length;
  expect(renewals).toBeGreaterThanOrEqual(3);
  unmount();
  clearInterval(watchdog);
  await settle(6000);
  expect(invoke.mock.calls.filter(([name]) => name === "screen_context_get_status")).toHaveLength(renewals);
});

it("clears the inline replay if its native visibility renewal fails", async () => {
  const { client, invoke } = fixture([0, 10, 20]);
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) => command === "screen_context_get_status"
    ? Promise.reject("screen_context_unavailable") : original(command, args));
  const { container } = render(<LocalizationTestProvider language="en">
    <ActivityScreenPreview client={client} selection={selection} mode="preview" onOpen={() => {}} />
  </LocalizationTestProvider>);
  await ready();
  expect(container.querySelector(".screen-player__screen img")).not.toBeNull();
  await settle(2200);
  expect(container.querySelector(".screen-player__screen img")).toBeNull();
});
