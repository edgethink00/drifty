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
        couponRedemption={null}
        couponRedemptionErrorCode={null}
        couponRedemptionLoading={false}
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
        onRedeemTrialCoupon={vi.fn()}
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
      couponRedemption: null,
      couponRedemptionErrorCode: null,
      couponRedemptionLoading: false,
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
      onRedeemTrialCoupon: vi.fn(),
      onRevokeCloudDevice: vi.fn(),
      onSignIn,
      onStartCloudSetup: vi.fn(),
    };

    render(<AccountSettingsSection {...props} />);

    expect(screen.getByText("Not signed in")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("normalizes and submits a trial code from Account settings", () => {
    const onRedeemTrialCoupon = vi.fn();
    const props: AccountSettingsSectionProps = {
      billingCheckoutLoadingInterval: null,
      billingEntitlementError: null,
      billingEntitlementLockedReason: null,
      billingEntitlementStatus: "trialing",
      billingPlansDisabled: false,
      billingPortalLoading: false,
      couponRedemption: null,
      couponRedemptionErrorCode: null,
      couponRedemptionLoading: false,
      cloudDeviceAccess: null,
      cloudDeviceActionError: null,
      cloudDeviceRevokingId: null,
      cloudDevices: [],
      cloudStatusRefreshing: false,
      currentBillingPlan: "free",
      isSupabaseConfigured: true,
      shouldShowCloudCheckoutPlans: true,
      userEmail: "alex@example.com",
      onManageCloudBilling: vi.fn(),
      onRefreshCloudStatus: vi.fn(),
      onRedeemTrialCoupon,
      onRevokeCloudDevice: vi.fn(),
      onSignIn: vi.fn(),
      onStartCloudSetup: vi.fn(),
    };

    const { rerender } = render(<AccountSettingsSection {...props} />);
    const codeInput = screen.getByRole("textbox", { name: /Drifty trial code/i });

    fireEvent.change(codeInput, { target: { value: " drft-test-2026 " } });
    expect(screen.queryByText(/offline trial code/i)).toBeNull();
    expect(screen.getByText("Trial code")).toBeTruthy();
    expect(codeInput.getAttribute("placeholder")).toBe("DRFT-XXXX-XXXX");

    fireEvent.click(screen.getByRole("button", { name: /^Apply code$/i }));

    expect(onRedeemTrialCoupon).toHaveBeenCalledWith("DRFT-TEST-2026");

    rerender(
      <AccountSettingsSection
        {...props}
        couponRedemption={{
          status: "redeemed",
          grantedDays: 30,
          trialEndsAt: "2026-10-01T00:00:00.000Z",
          redeemedAt: "2026-08-24T00:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("30 days added");

    rerender(
      <AccountSettingsSection
        {...props}
        couponRedemptionErrorCode="coupon_rate_limited"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Try again in 15 minutes");
    expect(codeInput.getAttribute("aria-invalid")).toBe("true");
    expect(codeInput.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("keeps active subscription management visible beside an already-used coupon notice", () => {
    const onManageCloudBilling = vi.fn();
    render(
      <AccountSettingsSection
        billingCheckoutLoadingInterval={null}
        billingEntitlementError={null}
        billingEntitlementLockedReason={null}
        billingEntitlementStatus="active"
        billingPlansDisabled={false}
        billingPortalLoading={false}
        couponRedemption={{
          status: "already_redeemed",
          grantedDays: 30,
          trialEndsAt: "2026-09-01T00:00:00.000Z",
          redeemedAt: "2026-07-24T00:00:00.000Z",
        }}
        couponRedemptionErrorCode={null}
        couponRedemptionLoading={false}
        cloudDeviceAccess={null}
        cloudDeviceActionError={null}
        cloudDeviceRevokingId={null}
        cloudDevices={[]}
        cloudStatusRefreshing={false}
        currentBillingPlan="individual"
        isSupabaseConfigured={true}
        shouldShowCloudCheckoutPlans={false}
        userEmail="alex@example.com"
        onManageCloudBilling={onManageCloudBilling}
        onRefreshCloudStatus={vi.fn()}
        onRedeemTrialCoupon={vi.fn()}
        onRevokeCloudDevice={vi.fn()}
        onSignIn={vi.fn()}
        onStartCloudSetup={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("already used a trial code");
    fireEvent.click(screen.getByRole("button", { name: /^Manage billing$/i }));
    expect(onManageCloudBilling).toHaveBeenCalledTimes(1);
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
        couponRedemption={null}
        couponRedemptionErrorCode={null}
        couponRedemptionLoading={false}
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
        onRedeemTrialCoupon={vi.fn()}
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
  it("keeps the trial-code action on the shared Settings control language", () => {
    const styles = readFileSync(desktopSourcePath("src/features/settings/TrialCouponRedemption.css"), "utf8");
    const markup = readFileSync(desktopSourcePath("src/features/settings/TrialCouponRedemption.tsx"), "utf8");

    expect(markup).toContain('className="settings-btn trial-coupon-form__submit"');
    expect(markup).not.toContain("settings-btn--primary");
    expect(styles).not.toContain("background: var(--accent);");
    expect(styles).toContain("height: var(--settings-control-height);");
    expect(styles).toContain("min-width: 10rem;");
    expect(styles).toContain("width: min(100%, 28rem);");
    expect(styles).not.toContain("grid-template-columns: minmax(12rem, 1fr) minmax(18rem, 24rem);");
  });
});
