// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionsSettingsSection } from "./PermissionsSettingsSection";

const {
  isPermissionGranted,
  openFullDiskAccessSettingsPane,
  openSystemSettingsPane,
  requestPermission,
  safariHistoryPermission,
} = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  openFullDiskAccessSettingsPane: vi.fn(),
  openSystemSettingsPane: vi.fn(),
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
    safariHistoryPermission.show = false;
    safariHistoryPermission.readable = false;
    safariHistoryPermission.opening = false;
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.unstubAllEnvs();
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
    expect(screen.getByText(/Windows allows Drifty notifications by default/)).toBeTruthy();
    fireEvent.click(settingsButton);
    await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("notifications"));
  });

  it("requests Accessibility but never reports a notification status it cannot read", async () => {
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

    // The desktop notification plugin answers "granted" without asking the OS,
    // so the row neither asks it nor shows Enabled/Not enabled.
    const notificationRow = screen.getByText("Notifications").closest(".settings-permission-row");
    expect(notificationRow?.querySelector(".settings-permission-status")).toBeNull();
    expect(notificationRow?.textContent).toContain("macOS allows Drifty notifications by default");
    expect(isPermissionGranted).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Allow notifications$/ })).toBeNull();
  });

  it("opens System Settings for an already granted permission and refreshes on focus", async () => {
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
    fireEvent.click(await within(accessibilityRow).findByRole("button", { name: /^Open System Settings$/ }));
    await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("accessibility"));

    onCheckAccessibility.mockClear();
    fireEvent.focus(window);
    await waitFor(() => expect(onCheckAccessibility).toHaveBeenCalledTimes(1));
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
