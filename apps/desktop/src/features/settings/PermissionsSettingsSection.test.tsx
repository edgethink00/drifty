// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionsSettingsSection } from "./PermissionsSettingsSection";
import { rememberMacosMajorVersion, resetReportedMacosMajorVersion } from "../../lib/api/accessibilityPaneName";

const {
  isPermissionGranted,
  openFullDiskAccessSettingsPane,
  openSystemSettingsPane,
  readNativeNotificationAuthorization,
  requestNativeNotificationAuthorization,
  requestPermission,
  safariHistoryPermission,
} = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  openFullDiskAccessSettingsPane: vi.fn(),
  openSystemSettingsPane: vi.fn(),
  readNativeNotificationAuthorization: vi.fn(),
  requestNativeNotificationAuthorization: vi.fn(),
  requestPermission: vi.fn(),
  safariHistoryPermission: {
    show: false,
    readable: false,
    opening: false,
    onEnable: vi.fn(),
  },
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted,
  requestPermission,
}));

vi.mock("../../lib/api/systemSettingsClient", () => ({
  openFullDiskAccessSettingsPane,
  openSystemSettingsPane,
}));

vi.mock("../../lib/api/nativeNotificationClient", () => ({
  readNativeNotificationAuthorization,
  requestNativeNotificationAuthorization,
}));

vi.mock("../onboarding/useSafariHistoryPermission", () => ({
  useSafariHistoryPermission: () => safariHistoryPermission,
}));

describe("PermissionsSettingsSection", () => {
  beforeEach(() => {
    // jsdom's user agent contains "darwin", which the host detector's
    // user-agent fallback reads as Windows. Pin the build-time host instead.
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "macos");
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.clearAllMocks();
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("granted");
    openSystemSettingsPane.mockResolvedValue(true);
    openFullDiskAccessSettingsPane.mockResolvedValue(true);
    readNativeNotificationAuthorization.mockResolvedValue("unavailable");
    requestNativeNotificationAuthorization.mockResolvedValue("authorized");
    safariHistoryPermission.show = false;
    safariHistoryPermission.readable = false;
    safariHistoryPermission.opening = false;
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.unstubAllEnvs();
    resetReportedMacosMajorVersion();
  });

  it("offers Windows Settings as the notification shortcut on Windows", async () => {
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "windows");

    render(
      <PermissionsSettingsSection
        accessibilityGranted
        accessibilityRequired={false}
        hostPlatform="windows"
        onCheckAccessibility={vi.fn().mockResolvedValue(true)}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
      />,
    );

    const settingsButton = await screen.findByRole("button", { name: /^Open Windows Settings$/ });
    expect(screen.queryByRole("button", { name: /^Open System Settings$/ })).toBeNull();
    expect(screen.getByText(/No separate permission is needed.+Windows Settings/)).toBeTruthy();
    fireEvent.click(settingsButton);
    await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("notifications"));
  });

  it("names the permission as macOS 27 System Settings does", async () => {
    rememberMacosMajorVersion(27);
    const onRequestAccessibility = vi.fn().mockResolvedValue(false);
    render(
      <PermissionsSettingsSection
        accessibilityGranted={false}
        accessibilityRequired
        onCheckAccessibility={vi.fn().mockResolvedValue(false)}
        onRequestAccessibility={onRequestAccessibility}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Allow Device Control and Data Access$/ }));
    await waitFor(() => expect(onRequestAccessibility).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Device Control and Data Access").closest(".settings-permission-row")).toBeTruthy();
    expect(screen.queryByText("Accessibility")).toBeNull();
  });

  it("requests Accessibility and shows no notification status when macOS cannot report one", async () => {
    const onCheckAccessibility = vi.fn().mockResolvedValue(false);
    const onRequestAccessibility = vi.fn().mockResolvedValue(false);

    render(
      <PermissionsSettingsSection
        accessibilityGranted={false}
        accessibilityRequired
        onCheckAccessibility={onCheckAccessibility}
        onRequestAccessibility={onRequestAccessibility}
      />,
    );

    await waitFor(() => expect(onCheckAccessibility).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /^Allow Accessibility$/ }));
    await waitFor(() => expect(onRequestAccessibility).toHaveBeenCalledTimes(1));
    const accessibilityRow = screen.getByText("Accessibility").closest(".settings-permission-row");
    expect(accessibilityRow?.querySelector(".settings-inline-link")).toBeNull();
    // A missing grant shows only its next step: no status text beside the button.
    expect(accessibilityRow?.querySelector(".settings-permission-status")).toBeNull();
    expect(accessibilityRow?.querySelectorAll(".settings-permission-control > *")).toHaveLength(1);

    // Outside an app bundle (and on Windows) only the plugin is left, which
    // answers "granted" without asking the OS: no status, no request button.
    const notificationRow = screen.getByText("Notifications").closest(".settings-permission-row");
    await waitFor(() => expect(readNativeNotificationAuthorization).toHaveBeenCalled());
    expect(notificationRow?.querySelector(".settings-permission-status")).toBeNull();
    // Its one control is the settings shortcut button, as before.
    expect(notificationRow?.querySelectorAll(".settings-permission-control > *")).toHaveLength(1);
    expect(notificationRow?.querySelector(".settings-btn")?.textContent).toBe("Open System Settings");
    expect(notificationRow?.textContent).toContain("Change how Drifty notifications appear in System Settings");
    expect(isPermissionGranted).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Allow notifications$/ })).toBeNull();
  });

  it("shows macOS's own notification answer and asks only while it is unanswered", async () => {
    readNativeNotificationAuthorization.mockResolvedValue("notDetermined");

    render(
      <PermissionsSettingsSection
        accessibilityGranted
        accessibilityRequired
        onCheckAccessibility={vi.fn().mockResolvedValue(true)}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
      />,
    );

    const notificationRow = screen.getByText("Notifications").closest(".settings-permission-row");
    if (!(notificationRow instanceof HTMLElement)) throw new Error("notification row missing");
    // Not asked: the request button is the row's only control.
    const allow = await within(notificationRow).findByRole("button", { name: /^Allow notifications$/ });
    expect(notificationRow.querySelector(".settings-permission-status")).toBeNull();
    expect(notificationRow.querySelectorAll(".settings-permission-control > *")).toHaveLength(1);
    expect(notificationRow.textContent).toContain("macOS asks once before Drifty can send notifications");
    fireEvent.click(allow);
    await waitFor(() => expect(requestNativeNotificationAuthorization).toHaveBeenCalledTimes(1));
    // Allowed: the status alone, with the settings shortcut as a quiet link in the description.
    expect((await within(notificationRow).findByText("Enabled")).getAttribute("data-tone")).toBe("success");
    expect(notificationRow.querySelector(".settings-btn")).toBeNull();
    expect(notificationRow.querySelector(".settings-inline-link")?.textContent).toContain("Open System Settings");
    expect(openSystemSettingsPane).not.toHaveBeenCalled();
    fireEvent.click(within(notificationRow).getByRole("button", { name: /Open System Settings/ }));
    await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("notifications"));
  });

  it("says the day review cannot arrive while notifications are off for Drifty", async () => {
    readNativeNotificationAuthorization.mockResolvedValue("denied");

    render(
      <PermissionsSettingsSection
        accessibilityGranted
        accessibilityRequired
        onCheckAccessibility={vi.fn().mockResolvedValue(true)}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
      />,
    );

    const notificationRow = screen.getByText("Notifications").closest(".settings-permission-row");
    if (!(notificationRow instanceof HTMLElement)) throw new Error("notification row missing");
    // Off: the step that turns them back on is the row's only control, and the description says why.
    await waitFor(() => expect(notificationRow.textContent).toContain("the day review cannot arrive"));
    expect(notificationRow.querySelector(".settings-permission-status")).toBeNull();
    expect(notificationRow.querySelectorAll(".settings-permission-control > *")).toHaveLength(1);
    expect(notificationRow.querySelector(".settings-inline-link")).toBeNull();
    fireEvent.click(within(notificationRow).getByRole("button", { name: /^Open System Settings$/ }));
    await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("notifications"));
    expect(requestNativeNotificationAuthorization).not.toHaveBeenCalled();
  });

  it("shows a granted permission as a status with a quiet settings link and refreshes it on focus", async () => {
    const onCheckAccessibility = vi.fn().mockResolvedValue(true);

    render(
      <PermissionsSettingsSection
        accessibilityGranted
        accessibilityRequired
        onCheckAccessibility={onCheckAccessibility}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
      />,
    );

    const accessibilityRow = screen.getByText("Accessibility").closest(".settings-permission-row");
    if (!(accessibilityRow instanceof HTMLElement)) throw new Error("accessibility row missing");
    expect(await within(accessibilityRow).findByText("Enabled")).toBeTruthy();
    // The status is the row's only control. The way into System Settings is a
    // text link under the description, never a bordered button beside the status.
    expect(accessibilityRow.querySelector(".settings-btn")).toBeNull();
    expect(accessibilityRow.querySelectorAll(".settings-permission-control > *")).toHaveLength(1);
    const settingsLink = within(accessibilityRow).getByRole("button", { name: /^Open System Settings$/ });
    expect(settingsLink.classList.contains("settings-inline-link")).toBe(true);
    fireEvent.click(settingsLink);
    await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("accessibility"));

    onCheckAccessibility.mockClear();
    fireEvent.focus(window);
    await waitFor(() => expect(onCheckAccessibility).toHaveBeenCalledTimes(1));
  });

  it("reports when a granted permission's settings app cannot open", async () => {
    openSystemSettingsPane.mockRejectedValueOnce(new Error("pane unavailable"));

    render(
      <PermissionsSettingsSection
        accessibilityGranted
        accessibilityRequired
        onCheckAccessibility={vi.fn().mockResolvedValue(true)}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
      />,
    );

    const accessibilityRow = screen.getByText("Accessibility").closest(".settings-permission-row");
    if (!(accessibilityRow instanceof HTMLElement)) throw new Error("accessibility row missing");
    fireEvent.click(await within(accessibilityRow).findByRole("button", { name: /^Open System Settings$/ }));
    expect((await within(accessibilityRow).findByRole("alert")).textContent).toContain("couldn't open the settings app");
    // The failed open is not reported as a failed permission check.
    expect(within(accessibilityRow).queryByText(/couldn't check this permission/)).toBeNull();
  });

  it("offers a retry on its own when the Accessibility check fails", async () => {
    const onCheckAccessibility = vi.fn().mockRejectedValueOnce(new Error("check failed")).mockResolvedValue(true);

    render(
      <PermissionsSettingsSection
        accessibilityGranted={false}
        accessibilityRequired
        onCheckAccessibility={onCheckAccessibility}
        onRequestAccessibility={vi.fn().mockResolvedValue(false)}
      />,
    );

    const accessibilityRow = screen.getByText("Accessibility").closest(".settings-permission-row");
    if (!(accessibilityRow instanceof HTMLElement)) throw new Error("accessibility row missing");
    expect((await within(accessibilityRow).findByRole("alert")).textContent).toContain("couldn't check this permission");
    expect(accessibilityRow.querySelector(".settings-permission-status")).toBeNull();
    fireEvent.click(within(accessibilityRow).getByRole("button", { name: /^Check again$/ }));
    await waitFor(() => expect(onCheckAccessibility).toHaveBeenCalledTimes(2));
  });

  it("opens notification settings directly and reports when the settings app cannot open", async () => {
    openSystemSettingsPane.mockRejectedValueOnce(new Error("pane unavailable"));

    render(
      <PermissionsSettingsSection
        accessibilityGranted
        accessibilityRequired
        onCheckAccessibility={vi.fn().mockResolvedValue(true)}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
      />,
    );

    const notificationRow = screen.getByText("Notifications").closest(".settings-permission-row");
    if (!(notificationRow instanceof HTMLElement)) throw new Error("notification row missing");
    expect(notificationRow.querySelector(".settings-inline-link")).toBeNull();
    fireEvent.click(within(notificationRow).getByRole("button", { name: /^Open System Settings$/ }));
    await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("notifications"));
    expect((await within(notificationRow).findByRole("alert")).textContent).toContain("couldn't open the settings app");
  });

  it("shows Safari history only when the environment probe qualifies it", async () => {
    safariHistoryPermission.show = true;

    render(
      <PermissionsSettingsSection
        accessibilityGranted={false}
        accessibilityRequired
        onCheckAccessibility={vi.fn().mockResolvedValue(false)}
        onRequestAccessibility={vi.fn().mockResolvedValue(false)}
      />,
    );

    expect(await screen.findByText("Safari history")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Allow Safari history$/ }));
    expect(safariHistoryPermission.onEnable).toHaveBeenCalledTimes(1);
  });

  it("shows a granted Safari history row as a status with a quiet Full Disk Access link", async () => {
    safariHistoryPermission.show = true;
    safariHistoryPermission.readable = true;

    render(
      <PermissionsSettingsSection
        accessibilityGranted
        accessibilityRequired
        onCheckAccessibility={vi.fn().mockResolvedValue(true)}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
      />,
    );

    const safariRow = screen.getByText("Safari history").closest(".settings-permission-row");
    if (!(safariRow instanceof HTMLElement)) throw new Error("safari row missing");
    expect(safariRow.querySelector(".settings-btn")).toBeNull();
    expect(within(safariRow).getByText("Enabled")).toBeTruthy();
    fireEvent.click(within(safariRow).getByRole("button", { name: /^Open System Settings$/ }));
    await waitFor(() => expect(openFullDiskAccessSettingsPane).toHaveBeenCalledTimes(1));
  });

  it("does not present the macOS Accessibility grant when the native platform does not require it", async () => {
    const onCheckAccessibility = vi.fn().mockResolvedValue(true);

    render(
      <PermissionsSettingsSection
        accessibilityGranted
        accessibilityRequired={false}
        onCheckAccessibility={onCheckAccessibility}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
      />,
    );

    await waitFor(() => expect(onCheckAccessibility).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Accessibility")).toBeNull();
    expect(screen.getByText("Notifications")).toBeTruthy();
  });

  it("renders every requirement label as a toned badge so the three priorities stay distinguishable", async () => {
    // The requirement labels carry their whole visual recipe through .ui-badge.
    // A label that keeps only .settings-permission-requirement renders as bare
    // text, which is invisible to the other assertions here because they match
    // on copy alone.
    safariHistoryPermission.show = true;
    const onCheckAccessibility = vi.fn().mockResolvedValue(false);

    render(
      <PermissionsSettingsSection
        accessibilityGranted={false}
        accessibilityRequired
        onCheckAccessibility={onCheckAccessibility}
        onRequestAccessibility={vi.fn().mockResolvedValue(false)}
      />,
    );

    await waitFor(() => expect(onCheckAccessibility).toHaveBeenCalledTimes(1));

    const toneOf = (label: string) => {
      const element = screen.getByText(label);
      return {
        isBadge: element.classList.contains("ui-badge"),
        tone: [...element.classList].filter((name) => name.startsWith("ui-badge--")),
      };
    };

    expect(toneOf("Required")).toEqual({ isBadge: true, tone: ["ui-badge--warn"] });
    expect(toneOf("Recommended")).toEqual({ isBadge: true, tone: [] });
    expect(toneOf("Optional")).toEqual({ isBadge: true, tone: ["ui-badge--quiet"] });
  });
});
