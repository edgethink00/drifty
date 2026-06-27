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
  it("shows Cloud active Macs in Account settings and removes a non-current Mac", () => {
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
          message: "This Drifty Cloud Individual plan is already active on 2 Macs.",
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
    expect(within(cloudDevices).getByText(/2\/2 active Macs/i)).toBeTruthy();
    expect(within(cloudDevices).getByText("Current Mac")).toBeTruthy();
    expect(within(cloudDevices).getByText("Current")).toBeTruthy();

    fireEvent.click(within(cloudDevices).getByRole("button", { name: /^Refresh Cloud devices$/i }));
    fireEvent.click(within(cloudDevices).getByRole("button", { name: /^Remove$/i }));

    expect(onRefreshCloudStatus).toHaveBeenCalledTimes(1);
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

  it("keeps Cloud device status badges on the shared pill radius", () => {
    const styles = readFileSync(desktopSourcePath("src/features/cloud-devices/CloudDeviceManagementPanel.css"), "utf8");
    const badgeRule = cssRule(styles, ".cloud-device-row__badge");
    const refreshRule = cssRule(styles, ".content--settings .settings-btn.cloud-device-management__refresh");
    const removeRule = cssRule(styles, ".content--settings .settings-btn.cloud-device-row__remove");

    expect(badgeRule).toContain("border-radius: var(--radius-pill);");
    expect(badgeRule).not.toContain("border-radius: 999px;");
    expect(refreshRule).toContain("height: 2rem;");
    expect(refreshRule).toContain("min-width: 2rem;");
    expect(refreshRule).toContain("width: 2rem;");
    expect(removeRule).toContain("var(--warn-soft)");
    expect(removeRule).toContain("var(--warn)");
  });

  it("stacks Account section actions under their descriptions", () => {
    const styles = readFileSync(desktopSourcePath("src/features/settings/AccountSettingsSection.css"), "utf8");
    const stackedRowRule = cssRule(styles, ".content--settings .settings-section--account .settings-row--stacked-action");
    const stackedControlRule = cssRule(styles, ".content--settings .settings-section--account .settings-row--stacked-action > .ctrl");

    expect(stackedRowRule).toContain("display: grid;");
    expect(stackedRowRule).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(stackedControlRule).toContain("justify-self: start;");
  });
});
