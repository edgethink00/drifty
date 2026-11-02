// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../../../localization/LocalizationContext";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { PermissionsStep } from "./PermissionsStep";
import { rememberMacosMajorVersion, resetReportedMacosMajorVersion } from "../../../../lib/api/accessibilityPaneName";
import { ScreenContextClient, type ScreenContextInvoke } from "../../../screen-context/screenContextClient";
import { ScreenRecordingOnboardingContext } from "../../../screen-context/ScreenRecordingOnboardingContext";

vi.mock("../../useLiveTrackingPreview", () => ({
  useLiveTrackingPreview: () => null,
}));
const { openSystemSettingsPane } = vi.hoisted(() => ({ openSystemSettingsPane: vi.fn(async () => true) }));
vi.mock("../../../../lib/api/systemSettingsClient", () => ({ openSystemSettingsPane }));
const clients: ScreenContextClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.dispose()); });

const LEASE = "a9db1b29-80fb-4104-9272-46e0845a4774";
function screenRecordingClient(apps: { id: string; name: string }[], { helperInstalled = true, granted = true, preGranted = false, configured = false } = {}) {
  const invoke = vi.fn<ScreenContextInvoke>(async (command) => {
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") return { leaseId: LEASE, value: { mode: "local", expiresAtMs: Date.now() + 900_000 } };
    if (command === "screen_context_get_status") return { leaseId: LEASE, value: { preferences: { enabled: false, replayEnabled: false,
      visibleTextEnabled: false, ocrEnabled: false, allowedApps: [], intervalSeconds: 10 }, preferencesInvalid: false, captureEnabled: false,
      helperInstalled, globalPaused: false, ocrSupported: true, supportedApps: apps, paused: false, running: false, preparing: false,
      accepted: 0, dropped: 0, lastFailure: null, lastAcceptedAtMs: null } };
    if (command === "screen_context_request_permission") return { leaseId: LEASE, value: { granted } };
    if (command === "screen_context_permission_status") return { granted: preGranted };
    if (command === "screen_context_was_configured") return configured;
    throw new Error("unexpected onboarding command " + command);
  });
  const client = new ScreenContextClient(invoke, true); client.setAccount(null); clients.push(client);
  return { client, invoke };
}

function permissionFlow(granted: boolean, required = true, safariHistoryPermission: object = { show: false }) {
  return {
    accessibilityRequired: required,
    accessibilityGranted: granted,
    notificationsReady: false,
    safariHistoryPermission,
    handleRequestAccessibilityClick: vi.fn(),
    handleNotificationPermissionClick: vi.fn(),
  } as unknown as OnboardingFlow;
}

describe("PermissionsStep settings guidance", () => {
  it("shows the macOS path before the request and removes it when permission is confirmed", () => {
    const pending = permissionFlow(false);
    const { rerender } = render(
      <LocalizationTestProvider language="ko">
        <PermissionsStep flow={pending} />
      </LocalizationTestProvider>,
    );
    expect(
      screen.getByText(/시스템 설정 → 개인정보 보호 및 보안/),
    ).toBeTruthy();
    // Priority sits beside the title as the shared badge, as in Settings > Permissions.
    expect(screen.getByText("필수").className).toBe("ui-badge");
    fireEvent.click(screen.getByRole("button", { name: "설정에서 허용" }));
    expect(pending.handleRequestAccessibilityClick).toHaveBeenCalledOnce();
    rerender(
      <LocalizationTestProvider language="ko">
        <PermissionsStep flow={permissionFlow(true)} />
      </LocalizationTestProvider>,
    );
    expect(
      screen.queryByText(/시스템 설정 → 개인정보 보호 및 보안/),
    ).toBeNull();
    // Once on, the row shows a status in place of its button and keeps its priority badge.
    expect(screen.queryByRole("button", { name: "설정에서 허용" })).toBeNull();
    expect(screen.getByText("허용됨").className).toBe("dc-onb-permission-status");
    expect(screen.getByText("필수")).toBeTruthy();
  });

  it("keeps macOS instructions out of the Windows permission step", () => {
    render(
      <LocalizationTestProvider language="en">
        <PermissionsStep flow={permissionFlow(false, false)} />
      </LocalizationTestProvider>,
    );
    expect(screen.queryByText("Finish in macOS Settings")).toBeNull();
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Recommended").className).toBe("ui-badge");
  });
});

describe("PermissionsStep buttons", () => {
  function rowOf(title: string): HTMLElement {
    const row = screen.getByText(title).closest("li");
    if (!(row instanceof HTMLElement)) throw new Error(title + " row was not rendered");
    return row;
  }

  it("names every macOS permission button Allow in Settings and ties each to its row", async () => {
    const onEnable = vi.fn();
    const { client } = screenRecordingClient([{ id: "textedit", name: "TextEdit" }]);
    render(
      <LocalizationTestProvider language="ko">
        <ScreenRecordingOnboardingContext.Provider value={{ client, chosen: false, choose: vi.fn() }}>
          <PermissionsStep flow={permissionFlow(false, true, { show: true, readable: false, opening: false, onEnable })} />
        </ScreenRecordingOnboardingContext.Provider>
      </LocalizationTestProvider>,
    );
    await screen.findByText("화면 기록");
    // All three rows send the person to System Settings, so they say so the same way.
    const buttons = screen.getAllByRole("button", { name: "설정에서 허용" });
    expect(buttons).toHaveLength(3);
    for (const title of ["손쉬운 사용", "Safari 방문 기록", "화면 기록"]) {
      const button = within(rowOf(title)).getByRole("button", { name: "설정에서 허용" });
      expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).toBe(title);
    }
    fireEvent.click(within(rowOf("Safari 방문 기록")).getByRole("button", { name: "설정에서 허용" }));
    expect(onEnable).toHaveBeenCalledOnce();
  });
});

describe("PermissionsStep on macOS 27", () => {
  afterEach(() => resetReportedMacosMajorVersion());

  it("points to Device Control and Data Access, the page's macOS 27 name", () => {
    rememberMacosMajorVersion(27);
    render(
      <LocalizationTestProvider language="ko">
        <PermissionsStep flow={permissionFlow(false)} />
      </LocalizationTestProvider>,
    );
    expect(screen.getByText("기기 제어 및 데이터 접근")).toBeTruthy();
    expect(screen.getByText(/개인정보 보호 및 보안 → 기기 제어 및 데이터 접근에서 drifty를 켜세요/)).toBeTruthy();
    expect(screen.queryByText(/손쉬운 사용/)).toBeNull();
  });
});

describe("PermissionsStep screen recording", () => {
  const macApps = [{ id: "textedit", name: "TextEdit" }, { id: "preview", name: "미리보기" }];
  async function recordingButton(name = "설정에서 허용") {
    const row = (await screen.findByText("화면 기록")).closest("li");
    if (!(row instanceof HTMLElement)) throw new Error("recording row was not rendered");
    return within(row).findByRole("button", { name });
  }
  function recordingRow(): HTMLElement {
    const row = screen.getByText("화면 기록").closest("li");
    if (!(row instanceof HTMLElement)) throw new Error("recording row was not rendered");
    return row;
  }
  function renderStep(client: ScreenContextClient, chosen: boolean, choose = vi.fn(), required = true) {
    const view = render(
      <LocalizationTestProvider language="ko">
        <ScreenRecordingOnboardingContext.Provider value={{ client, chosen, choose }}>
          <PermissionsStep flow={permissionFlow(false, required)} />
        </ScreenRecordingOnboardingContext.Provider>
      </LocalizationTestProvider>,
    );
    return { ...view, choose };
  }

  it("offers recording as an optional permission on macOS and only remembers the choice after the grant", async () => {
    const { client, invoke } = screenRecordingClient(macApps);
    const { choose, rerender } = renderStep(client, false);
    const allow = await recordingButton();
    expect(screen.getByText("화면 기록")).toBeTruthy();
    expect(screen.getByText(/TextEdit · 미리보기 화면을 이 컴퓨터에 저장해/)).toBeTruthy();
    expect(screen.getByText("선택").className).toContain("ui-badge--outline");
    fireEvent.click(allow);
    await waitFor(() => expect(choose).toHaveBeenCalledOnce());
    // Onboarding never saves the setting itself; App turns it on once tracking starts.
    expect(invoke.mock.calls.some(([command]) => command === "screen_context_configure")).toBe(false);
    rerender(
      <LocalizationTestProvider language="ko">
        <ScreenRecordingOnboardingContext.Provider value={{ client, chosen: true, choose }}>
          <PermissionsStep flow={permissionFlow(false)} />
        </ScreenRecordingOnboardingContext.Provider>
      </LocalizationTestProvider>,
    );
    expect(await within(recordingRow()).findByText("허용됨")).toBeTruthy();
    expect(within(recordingRow()).queryByRole("button")).toBeNull();
  });

  it("shows recording as on when macOS allowed it after this row's Allow and it was never set up", async () => {
    window.localStorage.setItem("drifty.screenRecording.requested", "1");
    const { client, invoke } = screenRecordingClient(macApps, { preGranted: true });
    const { choose } = renderStep(client, false);
    expect(await screen.findByText("허용됨")).toBeTruthy();
    expect(within(recordingRow()).queryByRole("button")).toBeNull();
    expect(choose).not.toHaveBeenCalled();
    expect(invoke.mock.calls.some(([command]) => command === "screen_context_configure")).toBe(false);
    window.localStorage.clear();
  });

  it("offers Turn on without asking again when macOS allowed it before Drifty asked", async () => {
    window.localStorage.clear();
    const { client, invoke } = screenRecordingClient(macApps, { preGranted: true });
    const { choose } = renderStep(client, false);
    fireEvent.click(await recordingButton("켜기"));
    expect(choose).toHaveBeenCalledOnce();
    expect(invoke.mock.calls.some(([command]) => command === "screen_context_request_permission")).toBe(false);
    expect(invoke.mock.calls.some(([command]) => command === "screen_context_configure")).toBe(false);
  });

  it("offers Allow again when the permission is granted but recording was turned off before", async () => {
    const { client } = screenRecordingClient(macApps, { preGranted: true, configured: true });
    renderStep(client, false);
    expect(await recordingButton()).toBeTruthy();
  });

  it("stays unchosen when macOS denies the permission and then opens System Settings", async () => {
    openSystemSettingsPane.mockClear();
    const { client } = screenRecordingClient(macApps, { granted: false });
    const { choose } = renderStep(client, false);
    fireEvent.click(await recordingButton());
    // The row re-renders once the request settles; query it afresh.
    await screen.findByText(/아직 허용되지 않았어요/);
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(await recordingButton());
    expect(openSystemSettingsPane).toHaveBeenLastCalledWith("screenRecording", { guide: true });
  });

  it("offers Turn on without a permission request on Windows", async () => {
    const { client, invoke } = screenRecordingClient([{ id: "notepad", name: "메모장" }]);
    const { choose } = renderStep(client, false, vi.fn(), false);
    fireEvent.click(await recordingButton("켜기"));
    expect(choose).toHaveBeenCalledOnce();
    expect(invoke.mock.calls.some(([command]) => command === "screen_context_request_permission")).toBe(false);
  });

  it("does not suggest recording when this computer cannot record", async () => {
    const { client, invoke } = screenRecordingClient(macApps, { helperInstalled: false });
    renderStep(client, false);
    await waitFor(() => expect(invoke.mock.calls.some(([command]) => command === "screen_context_get_status")).toBe(true));
    expect(screen.queryByText("화면 기록")).toBeNull();
  });
});
