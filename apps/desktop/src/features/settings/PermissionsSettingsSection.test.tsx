// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  });

  it("requests OS permissions without changing notification feature preferences", async () => {
    const onCheckAccessibility = vi.fn().mockResolvedValue(false);
    const onRequestAccessibility = vi.fn().mockResolvedValue(false);

    render(
      <PermissionsSettingsSection
        accessibilityGranted={false}
        onCheckAccessibility={onCheckAccessibility}
        onRequestAccessibility={onRequestAccessibility}
      />,
    );

    await waitFor(() => expect(onCheckAccessibility).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /^Allow Accessibility$/ }));
    await waitFor(() => expect(onRequestAccessibility).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("button", { name: /^Allow notifications$/ }));
    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^Enabled$/)).toBeTruthy();
    expect(openSystemSettingsPane).not.toHaveBeenCalledWith("notifications");
  });

  it("opens System Settings for an already granted permission and refreshes on focus", async () => {
    const onCheckAccessibility = vi.fn().mockResolvedValue(true);

    render(
      <PermissionsSettingsSection
        accessibilityGranted
        onCheckAccessibility={onCheckAccessibility}
        onRequestAccessibility={vi.fn().mockResolvedValue(true)}
      />,
    );

    const accessibilitySettingsButtons = await screen.findAllByRole("button", { name: /^Open System Settings$/ });
    fireEvent.click(accessibilitySettingsButtons[0]);
    await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("accessibility"));

    onCheckAccessibility.mockClear();
    fireEvent.focus(window);
    await waitFor(() => expect(onCheckAccessibility).toHaveBeenCalledTimes(1));
  });

  it("keeps a denied notification permission routed to System Settings after focus refresh", async () => {
    requestPermission.mockResolvedValueOnce("denied");

    render(
      <PermissionsSettingsSection
        accessibilityGranted={false}
        onCheckAccessibility={vi.fn().mockResolvedValue(false)}
        onRequestAccessibility={vi.fn().mockResolvedValue(false)}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Allow notifications$/ }));
    expect(await screen.findByRole("button", { name: /^Open System Settings$/ })).toBeTruthy();

    fireEvent.focus(window);
    const notificationSettingsButton = await screen.findByRole("button", { name: /^Open System Settings$/ });
    fireEvent.click(notificationSettingsButton);
    await waitFor(() => expect(openSystemSettingsPane).toHaveBeenCalledWith("notifications"));
  });

  it("shows Safari history only when the environment probe qualifies it", async () => {
    safariHistoryPermission.show = true;

    render(
      <PermissionsSettingsSection
        accessibilityGranted={false}
        onCheckAccessibility={vi.fn().mockResolvedValue(false)}
        onRequestAccessibility={vi.fn().mockResolvedValue(false)}
      />,
    );

    expect(await screen.findByText("Safari history")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Allow Safari history$/ }));
    expect(safariHistoryPermission.onEnable).toHaveBeenCalledTimes(1);
  });
});
