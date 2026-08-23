// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountSettingsSection, type AccountSettingsSectionProps } from "./AccountSettingsSection";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

function desktopSourcePath(relativePath: string): string {
  const rootPath = join(process.cwd(), "apps/desktop", relativePath);
  return existsSync(rootPath) ? rootPath : join(process.cwd(), relativePath);
}

describe("AccountSettingsSection", () => {
  it("shows active Cloud devices in Account settings and confirms before removing a non-current device", () => {
    const onRevokeCloudDevice = vi.fn();
    const onRefreshCloudStatus = vi.fn();

    render(
      <AccountSettingsSection
        billingCheckoutLoadingInterval={null}
        billingEntitlementError={null}
        billingEntitlementLockedReason="device_limit_reached"
        billingEntitlementStatus="locked"
        billingPlansDisabled={false}
        billingPortalLoading={false}
        cloudDeviceAccess={{
          allowed: false,
          reason: "device_limit_reached",
          message: "This Drifty Cloud Individual plan is already active on 2 desktop devices.",
          activeDeviceCount: 2,
          maxActiveDevices: 2,
          activeWindowDays: 30,
          deviceId: null,
        }}
        cloudDeviceActionError={null}
        cloudDeviceRevokingId={null}
        cloudDevices={[
          {
            id: "device-current",
            label: "Current Mac",
            platform: "macos",
            appVersion: "0.9.0",
            firstSeenAt: "2026-06-01T00:00:00.000Z",
            lastSeenAt: "2026-06-26T00:00:00.000Z",
            revokedAt: null,
            isCurrent: true,
            isActive: true,
          },
          {
            id: "device-old",
            label: "Old MacBook",
            platform: "macos",
            appVersion: "0.9.0",
            firstSeenAt: "2026-06-01T00:00:00.000Z",
            lastSeenAt: "2026-06-25T00:00:00.000Z",
            revokedAt: null,
            isCurrent: false,
            isActive: true,
          },
        ]}
        cloudStatusRefreshing={false}
        currentBillingPlan="individual"
        isSupabaseConfigured={true}
        shouldShowCloudCheckoutPlans={false}
        userEmail="alex@example.com"
        onManageCloudBilling={vi.fn()}
        onRefreshCloudStatus={onRefreshCloudStatus}
        onRevokeCloudDevice={onRevokeCloudDevice}
        onSignIn={vi.fn()}
        onStartCloudSetup={vi.fn()}
      />,
    );

    expect(screen.getByText("alex@example.com")).toBeTruthy();
    expect(screen.getByText(/Device limit reached/i)).toBeTruthy();

    const cloudDevices = screen.getByRole("region", { name: /Cloud devices/i });
    expect(within(cloudDevices).getByText(/2\/2 active desktop devices/i)).toBeTruthy();
    expect(within(cloudDevices).getByText("Current Mac")).toBeTruthy();
    expect(within(cloudDevices).getByText("Current")).toBeTruthy();

    fireEvent.click(within(cloudDevices).getByRole("button", { name: /^Refresh Cloud devices$/i }));
    fireEvent.click(within(cloudDevices).getByRole("button", { name: /^Remove$/i }));

    expect(onRefreshCloudStatus).toHaveBeenCalledTimes(1);
    expect(onRevokeCloudDevice).not.toHaveBeenCalled();

    const cancelDialog = screen.getByRole("alertdialog", { name: /^Remove this device\?$/i });
    expect(within(cancelDialog).getAllByText(/Old MacBook/).length).toBeGreaterThan(0);

    fireEvent.click(within(cancelDialog).getByRole("button", { name: /^Cancel$/i }));

    expect(screen.queryByRole("alertdialog", { name: /^Remove this device\?$/i })).toBeNull();

    fireEvent.click(within(cloudDevices).getByRole("button", { name: /^Remove$/i }));

    const confirmDialog = screen.getByRole("alertdialog", { name: /^Remove this device\?$/i });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: /^Remove device$/i }));

    expect(onRevokeCloudDevice).toHaveBeenCalledWith("device-old");
  });

  it("shows a sign-in action when Account settings has no signed-in user", () => {
    const onSignIn = vi.fn();
    const props: AccountSettingsSectionProps = {
      billingCheckoutLoadingInterval: null,
      billingEntitlementError: null,
      billingEntitlementLockedReason: null,
      billingEntitlementStatus: null,
      billingPlansDisabled: false,
      billingPortalLoading: false,
      cloudDeviceAccess: null,
      cloudDeviceActionError: null,
      cloudDeviceRevokingId: null,
      cloudDevices: [],
      cloudStatusRefreshing: false,
      currentBillingPlan: "free",
      isSupabaseConfigured: true,
      shouldShowCloudCheckoutPlans: true,
      userEmail: null,
      onManageCloudBilling: vi.fn(),
      onRefreshCloudStatus: vi.fn(),
      onRevokeCloudDevice: vi.fn(),
      onSignIn,
      onStartCloudSetup: vi.fn(),
    };

    render(<AccountSettingsSection {...props} />);

    expect(screen.getByText("Not signed in")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("surfaces Cloud device access failures instead of presenting an empty device list", () => {
    render(
      <AccountSettingsSection
        billingCheckoutLoadingInterval={null}
        billingEntitlementError={null}
        billingEntitlementLockedReason={null}
        billingEntitlementStatus="active"
        billingPlansDisabled={false}
        billingPortalLoading={false}
        cloudDeviceAccess={{
          allowed: false,
          reason: "unavailable",
          message: "Drifty Cloud device access is unavailable.",
          activeDeviceCount: null,
          maxActiveDevices: 2,
          activeWindowDays: 30,
          deviceId: null,
        }}
        cloudDeviceActionError={null}
        cloudDeviceRevokingId={null}
        cloudDevices={[]}
        cloudStatusRefreshing={false}
        currentBillingPlan="individual"
        isSupabaseConfigured={true}
        shouldShowCloudCheckoutPlans={false}
        userEmail="alex@example.com"
        onManageCloudBilling={vi.fn()}
        onRefreshCloudStatus={vi.fn()}
        onRevokeCloudDevice={vi.fn()}
        onSignIn={vi.fn()}
        onStartCloudSetup={vi.fn()}
      />,
    );

    const cloudDevices = screen.getByRole("region", { name: /Cloud devices/i });
    expect(within(cloudDevices).getByText("Drifty Cloud device access is unavailable.")).toBeTruthy();
    expect(within(cloudDevices).queryByText(/Refresh devices to load active desktop devices/i)).toBeNull();
  });

  it("keeps Cloud device status badges on the shared pill radius", () => {
    const styles = readFileSync(desktopSourcePath("src/features/cloud-devices/CloudDeviceManagementPanel.css"), "utf8");
    const badgeRule = cssRule(styles, ".cloud-device-row__badge");
    const refreshRule = cssRule(styles, ".content--settings .settings-btn.cloud-device-management__refresh");
    const removeRule = cssRule(styles, ".content--settings .settings-btn.cloud-device-row__remove");
    const confirmOverlayRule = cssRule(styles, ".cloud-device-confirm");

    expect(badgeRule).toContain("border-radius: var(--radius-pill);");
    expect(badgeRule).not.toContain("border-radius: 999px;");
    expect(refreshRule).toContain("height: 2rem;");
    expect(refreshRule).toContain("min-width: 2rem;");
    expect(refreshRule).toContain("width: 2rem;");
    expect(removeRule).toContain("var(--warn-soft)");
    expect(removeRule).toContain("var(--warn)");
    expect(confirmOverlayRule).toContain("position: fixed;");
    expect(confirmOverlayRule).toContain("z-index: var(--z-settings-popover);");
    // The confirm's danger button now uses the shared modal-btn--danger chrome
    // (styles/modal-chrome.css), so this stylesheet carries no per-button rule.
    expect(styles).not.toContain(".cloud-device-confirm__remove");
  });

  it("keeps consistent spacing between Account settings sections", () => {
    const styles = readFileSync(desktopSourcePath("src/features/settings/AccountSettingsSection.css"), "utf8");
    const sectionRule = cssRule(styles, ".content--settings .settings-section--account");
    const stackedRowRule = cssRule(styles, ".content--settings .settings-section--account .settings-row--stacked-action");
    const stackedControlRule = cssRule(styles, ".content--settings .settings-section--account .settings-row--stacked-action > .ctrl");

    expect(sectionRule).toContain("gap: var(--space-5);");
    expect(stackedRowRule).toContain("display: grid;");
    expect(stackedRowRule).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(stackedControlRule).toContain("justify-self: start;");
  });
});
