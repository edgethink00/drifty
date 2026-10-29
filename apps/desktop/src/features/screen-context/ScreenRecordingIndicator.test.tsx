// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ScreenContextStatus } from "@drifty/domain";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ScreenContextClient, type ScreenContextInvoke } from "./screenContextClient";
import { ScreenRecordingIndicator } from "./ScreenRecordingIndicator";

const LEASE = "a9db1b29-80fb-4104-9272-46e0845a4774";
const clients: ScreenContextClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.dispose()); vi.useRealTimers(); });

async function fixture(overrides: Partial<ScreenContextStatus> = {}) {
  let failure = false;
  let status: ScreenContextStatus = {
    preferences: { enabled: true, replayEnabled: true, visibleTextEnabled: true, ocrEnabled: false, allowedApps: ["textedit"], intervalSeconds: 10 },
    preferencesInvalid: false, captureEnabled: true, helperInstalled: true, globalPaused: false, ocrSupported: true,
    supportedApps: [{ id: "textedit", name: "TextEdit" }], paused: false, running: true, preparing: false,
    accepted: 1, dropped: 0, lastFailure: null, lastAcceptedAtMs: Date.now(), ...overrides,
  };
  const invoke = vi.fn<ScreenContextInvoke>(async (command, args) => {
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") return { leaseId: LEASE, value: { mode: "local", expiresAtMs: Date.now() + 900_000 } };
    if (command === "screen_context_get_status") {
      if (failure) throw new Error("screen_context_unavailable");
      return { leaseId: LEASE, value: status };
    }
    if (command === "screen_context_configure") {
      status = { ...status, preferences: { ...status.preferences, enabled: Boolean((args?.preferences as { enabled: boolean }).enabled) }, paused: false };
      return { leaseId: LEASE, value: status };
    }
    throw new Error("Unexpected indicator command: " + command);
  });
  const client = new ScreenContextClient(invoke, true); client.setAccount(null); clients.push(client);
  await client.connect();
  const openSettings = vi.fn();
  const view = render(<LocalizationTestProvider language="ko"><ScreenRecordingIndicator client={client} onOpenSettings={openSettings} /></LocalizationTestProvider>);
  return { ...view, client, invoke, openSettings, fail: (value: boolean) => { failure = value; } };
}

it.each([
  [{ lastFailure: "storage" }, "화면 저장 오류", "attention"],
  [{ lastFailure: "permission" }, "화면 기록 권한 필요", "attention"],
  [{ captureEnabled: false }, "화면 기록 중단", "attention"],
  [{ lastAcceptedAtMs: null }, "화면 기록 대기", "paused"],
  [{ lastFailure: "excluded" }, "화면 기록 대기", "paused"],
  [{ paused: true }, "화면 기록 멈춤", "paused"],
  [{ globalPaused: true, lastFailure: "storage" }, "화면 기록 멈춤", "paused"],
  [{}, "화면 기록 중", "recording"],
] as const)("reflects the actual recording state for %j", async (status, label, tone) => {
  const { invoke } = await fixture(status);
  expect((await screen.findByRole("button", { name: label })).getAttribute("data-state")).toBe(tone);
  expect(invoke.mock.calls.some(([command]) => command.includes("configure") || command.includes("request_permission"))).toBe(false);
});

it("explains a storage failure and opens the existing settings without turning capture on", async () => {
  const { openSettings, invoke } = await fixture({ lastFailure: "storage" });
  fireEvent.click(await screen.findByRole("button", { name: "화면 저장 오류" }));
  expect(screen.getByText("공간을 확보하거나 오래된 화면을 지우면 다시 저장해요.")).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "화면 기록 설정" }));
  expect(openSettings).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(invoke.mock.calls.some(([command]) => command.includes("configure"))).toBe(false);
});

it("replaces stale recording status after a failed poll and recovers after a successful poll", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const f = await fixture();
  await screen.findByRole("button", { name: "화면 기록 중" });
  f.fail(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  expect(screen.queryByRole("button", { name: "화면 기록 중" })).toBeNull();
  expect(await screen.findByRole("button", { name: "화면 기록 상태 미확인" })).toBeTruthy();
  f.fail(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  expect(await screen.findByRole("button", { name: "화면 기록 중" })).toBeTruthy();
});

it("keeps the existing turn-off action", async () => {
  const { invoke } = await fixture();
  fireEvent.click(await screen.findByRole("button", { name: "화면 기록 중" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "화면 기록 끄기" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "화면 기록 중" })).toBeNull());
  expect(invoke.mock.calls.find(([command]) => command === "screen_context_configure")?.[1]).toMatchObject({ preferences: { enabled: false }, resume: false });
});

it("hides the old account's status immediately when its capability is invalidated", async () => {
  const { client } = await fixture();
  fireEvent.click(await screen.findByRole("button", { name: "화면 기록 중" }));
  act(() => client.invalidate());
  expect(screen.queryByRole("button", { name: "화면 기록 중" })).toBeNull();
  expect(screen.queryByRole("menu")).toBeNull();
});

it("hides the indicator when the recording helper is unavailable", async () => {
  const { container, invoke } = await fixture({ helperInstalled: false });
  await waitFor(() => expect(invoke.mock.calls.some(([command]) => command === "screen_context_get_status")).toBe(true));
  expect(container.textContent).toBe("");
});
