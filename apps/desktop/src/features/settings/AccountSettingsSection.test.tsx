// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSettingsSection, ORGANIZATION_SEAT_MANAGEMENT_URL, type AccountSettingsSectionProps } from "./AccountSettingsSection";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS } from "../localization/translations";
import type { BillingEntitlement, BillingEntitlementOrganizationRole } from "../billing/billingService";

const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ hasRequiredAccountAuth: false, user: null }),
}));

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

function desktopSourcePath(relativePath: string): string {
  const rootPath = join(process.cwd(), "apps/desktop", relativePath);
  return existsSync(rootPath) ? rootPath : join(process.cwd(), relativePath);
}

describe("AccountSettingsSection", () => {
  it("shows active Cloud devices in Account settings and confirms before removing a non-current device", async () => {
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
          message: "This Drifty Pro plan is already active on 2 desktop devices.",
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
    const accountHeading = screen.getByRole("heading", { name: /Signed-in account/i });
    const accountBlock = accountHeading.closest(".settings-block");
    expect(accountBlock).toBeTruthy();
    expect(accountBlock?.contains(screen.getByText("alex@example.com"))).toBe(true);
    expect(accountBlock?.contains(cloudDevices)).toBe(true);
    expect(
      screen.getByText("alex@example.com").compareDocumentPosition(cloudDevices)
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(cloudDevices).getByText(/2\/2 active desktop devices/i)).toBeTruthy();
    expect(within(cloudDevices).getByText("Current Mac")).toBeTruthy();
    expect(within(cloudDevices).getByText("Current")).toBeTruthy();

    fireEvent.click(within(cloudDevices).getByRole("button", { name: /^Refresh Cloud devices$/i }));
    fireEvent.click(within(cloudDevices).getByRole("button", { name: /^Remove$/i }));

    expect(onRefreshCloudStatus).toHaveBeenCalledTimes(1);
    expect(onRevokeCloudDevice).not.toHaveBeenCalled();

    const cancelDialog = screen.getByRole("alertdialog", { name: /^Remove this device\?$/i });
    expect(within(cancelDialog).getAllByText(/Old MacBook/).length).toBeGreaterThan(0);

    await waitFor(() => expect(cancelDialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open"));
    fireEvent.click(within(cancelDialog).getByRole("button", { name: /^Cancel$/i }));

    expect(screen.getByRole("alertdialog", { name: /^Remove this device\?$/i })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: /^Remove this device\?$/i })).toBeNull());

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
    const publicProfileHeading = screen.getByRole("heading", { name: /^Public profile$/i });
    expect(within(publicProfileHeading).getByText("Beta").className).toContain("settings-beta-badge");
    expect(screen.queryByRole("heading", { name: /Public profile Beta/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("exposes account deletion only for a signed-in account", () => {
    const onDeleteAccount = vi.fn();
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
      onDeleteAccount,
      onManageCloudBilling: vi.fn(),
      onRefreshCloudStatus: vi.fn(),
      onRedeemTrialCoupon: vi.fn(),
      onRevokeCloudDevice: vi.fn(),
      onSignIn: vi.fn(),
      onStartCloudSetup: vi.fn(),
    };

    const { rerender } = render(<AccountSettingsSection {...props} />);
    const dangerHeading = screen.getByRole("heading", { name: /^Danger zone$/i });
    expect(dangerHeading.closest(".settings-block")?.textContent).toContain("Local activity and locally saved work or setup state stay");
    fireEvent.click(screen.getByRole("button", { name: /^Delete account$/i }));
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);

    rerender(<AccountSettingsSection {...props} userEmail={null} />);
    expect(screen.queryByRole("heading", { name: /^Danger zone$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete account$/i })).toBeNull();

    rerender(<AccountSettingsSection {...props} hasSignedInAccount userEmail={null} />);
    expect(screen.getByText("Signed in")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Delete account$/i })).toBeTruthy();

    rerender(<AccountSettingsSection {...props} hasSignedInAccount={false} />);
    expect(screen.queryByRole("heading", { name: /^Danger zone$/i })).toBeNull();

    rerender(
      <AccountSettingsSection
        {...props}
        hasAuthenticatedSession
        hasSignedInAccount={false}
        userEmail={null}
      />,
    );
    expect(screen.getByRole("button", { name: /^Delete account$/i })).toBeTruthy();

    rerender(
      <AccountSettingsSection
        {...props}
        hasAuthenticatedSession={false}
        hasSignedInAccount={false}
        userEmail={null}
      />,
    );
    expect(screen.queryByRole("heading", { name: /^Danger zone$/i })).toBeNull();
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
    // The promo field is collapsed by default so it does not compete with the
    // plan cards; expand it before entering a code.
    expect(screen.queryByRole("textbox", { name: /Drifty promo code/i })).toBeNull();
    const promoToggle = screen.getByRole("button", { name: /Promo code/i });
    expect(promoToggle.firstElementChild?.textContent).toBe("Promo code");
    expect(promoToggle.lastElementChild?.textContent).toBe("+");
    fireEvent.click(promoToggle);
    expect(promoToggle.lastElementChild?.textContent).toBe("−");
    const codeInput = screen.getByRole("textbox", { name: /Drifty promo code/i });

    fireEvent.change(codeInput, { target: { value: " drft-test-2026 " } });
    expect(screen.queryByText(/offline promo code/i)).toBeNull();
    expect(screen.getByText("Promo code")).toBeTruthy();
    expect(codeInput.getAttribute("placeholder")).toBe("DRFT-XXXX");

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

  it("keeps active subscription management visible beside an already-used coupon notice", async () => {
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

    expect(screen.getByRole("status").textContent).toContain("already used a promo code");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Manage billing$/i })); });
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

  it("recovers a blocked payment from the plan summary instead of starting checkout", async () => {
    const onManageCloudBilling = vi.fn();
    const onStartCloudSetup = vi.fn();

    render(
      <AccountSettingsSection
        billingCheckoutLoadingInterval={null}
        billingEntitlementError={null}
        billingEntitlementLockedReason="payment_required"
        billingEntitlementStatus="locked"
        billingPlansDisabled={false}
        billingPortalLoading={false}
        couponRedemption={null}
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
        onStartCloudSetup={onStartCloudSetup}
      />,
    );

    expect(screen.getByText(/Update payment on this subscription to resume Cloud AI/i)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Fix billing$/i })); });
    expect(onManageCloudBilling).toHaveBeenCalledTimes(1);
    expect(onStartCloudSetup).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /choose drifty pro plan/i })).toBeNull();
  });

  it("keeps Promo code outside the Account heading block, directly under the plan summary", () => {
    const markup = readFileSync(desktopSourcePath("src/features/settings/AccountSettingsSection.tsx"), "utf8");
    const plansClose = markup.indexOf("</div>", markup.indexOf("settings-block--plans"));
    const coupon = markup.indexOf("<TrialCouponRedemption");
    const signedIn = markup.indexOf('t("settings.account.signedIn")');
    expect(coupon).toBeGreaterThan(plansClose);
    expect(coupon).toBeLessThan(signedIn);
    expect(markup.indexOf("<TrialCouponRedemption", markup.indexOf("settings-block--plans"))).toBe(coupon);
  });

  it("keeps consistent spacing between Account settings sections", () => {
    const styles = readFileSync(desktopSourcePath("src/features/settings/AccountSettingsSection.css"), "utf8");
    const sharedPlanStyles = readFileSync(desktopSourcePath("src/styles/settings-polish.css"), "utf8");
    const sectionRule = cssRule(styles, ".content--settings .settings-section--account");
    const stackedRowRule = cssRule(styles, ".content--settings .settings-section--account .settings-row--stacked-action");
    const stackedControlRule = cssRule(styles, ".content--settings .settings-section--account .settings-row--stacked-action > .ctrl");
    const cloudDevicePanelRule = cssRule(styles, ".content--settings .settings-section--account .settings-block--cloud-account .cloud-device-management");
    const sharedPlanSuiteRule = cssRule(sharedPlanStyles, ".individual-plan-suite");
    const sharedPlanIntervalsRule = cssRule(sharedPlanStyles, ".individual-plan-intervals");
    const sharedPlanCardsRule = cssRule(sharedPlanStyles, ".individual-plan-cards");
    const sharedSectionHeadingRule = cssRule(sharedPlanStyles, ".content--settings .settings-block > h3");
    const couponRowRule = cssRule(styles, ".content--settings .settings-section--account > .settings-row--coupon");
    const couponSpacingRule = cssRule(styles, ".content--settings .settings-section--account .settings-block--plans + .settings-row--coupon");
    const dangerLabelRule = cssRule(styles, ".content--settings .settings-section--account .settings-block--danger-zone .lbl");

    expect(sectionRule).toContain("gap: var(--space-5);");
    expect(stackedRowRule).toContain("display: grid;");
    expect(stackedRowRule).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(stackedControlRule).toContain("justify-self: start;");
    expect(cloudDevicePanelRule).toContain("background: transparent;");
    expect(cloudDevicePanelRule).toContain("border: 0;");
    expect(cloudDevicePanelRule).toContain("padding: 0;");
    expect(sharedPlanSuiteRule).toContain("gap: var(--space-2);");
    expect(sharedPlanSuiteRule).toContain("max-width: 42rem;");
    expect(sharedPlanIntervalsRule).toContain("justify-self: start;");
    expect(sharedPlanIntervalsRule).toContain("margin: 0;");
    expect(sharedPlanCardsRule).toContain("margin: 0;");
    expect(sharedSectionHeadingRule).toContain("color: var(--text-soft);");
    expect(couponRowRule).toContain("min-height: 0;");
    expect(couponSpacingRule).toContain("margin-bottom: calc(var(--space-6) - var(--space-5));");
    expect(couponSpacingRule).toContain("margin-top: calc(var(--space-3) - var(--space-5));");
    expect(dangerLabelRule).toContain("color: var(--warn);");
    expect(styles).not.toContain(".settings-block--danger-zone h3");
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

const individualEntitlement = {
  plan: "individual",
  status: "active",
  canUseApp: true,
  trialEndsAt: null,
  currentPeriodEnd: "2026-12-01T00:00:00.000Z",
} as const satisfies BillingEntitlement;

function organizationEntitlement(role: BillingEntitlementOrganizationRole): BillingEntitlement {
  return {
    ...individualEntitlement,
    entitlementOwner: "organization",
    organization: {
      id: "org-1",
      name: "Acme",
      role,
      seatId: "seat-1",
    },
  };
}

function accountProps(overrides: Partial<AccountSettingsSectionProps> = {}): AccountSettingsSectionProps {
  return {
    billingCheckoutLoadingInterval: null,
    billingEntitlementError: null,
    billingEntitlementLockedReason: null,
    billingEntitlementStatus: "active",
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
    currentBillingPlan: "individual",
    isSupabaseConfigured: true,
    shouldShowCloudCheckoutPlans: false,
    userEmail: "alex@example.com",
    onManageCloudBilling: vi.fn(),
    onRefreshCloudStatus: vi.fn(),
    onRedeemTrialCoupon: vi.fn(),
    onRevokeCloudDevice: vi.fn(),
    onSignIn: vi.fn(),
    onStartCloudSetup: vi.fn(),
    ...overrides,
  };
}

describe("AccountSettingsSection organization seat", () => {
  beforeEach(() => {
    openUrlMock.mockReset();
    openUrlMock.mockResolvedValue(undefined);
  });

  it("renders an individual entitlement as a personal plan with no organization row or seat management", () => {
    render(<AccountSettingsSection {...accountProps({ billingEntitlement: individualEntitlement })} />);

    expect(screen.getByText("Drifty Pro")).toBeTruthy();
    expect(screen.getByText("Manage your Cloud AI subscription and billing.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Manage billing$/i })).toBeTruthy();
    expect(screen.queryByText("Organization seat")).toBeNull();
    expect(screen.queryByText(/organization seat at/i)).toBeNull();
    expect(screen.queryByText(/^Role:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Manage seats$/i })).toBeNull();
  });

  it("shows the organization name and role for a member seat without a management entry point", () => {
    render(<AccountSettingsSection {...accountProps({ billingEntitlement: organizationEntitlement("member") })} />);

    expect(screen.getByText("Organization seat")).toBeTruthy();
    expect(screen.getByText(/organization seat at Acme, not a personal subscription/i)).toBeTruthy();
    expect(screen.getByText(/Role: Member/)).toBeTruthy();
    expect(screen.queryByText("Drifty Pro")).toBeNull();
    expect(screen.queryByText("Manage your Cloud AI subscription and billing.")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Manage billing$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Manage seats$/i })).toBeNull();
  });

  it.each(["owner", "admin"] as const)("shows seat management for an %s and opens the organization page", async (role) => {
    render(<AccountSettingsSection {...accountProps({ billingEntitlement: organizationEntitlement(role) })} />);

    const manageSeats = screen.getByRole("button", { name: /^Manage seats$/i });
    expect(manageSeats).toBeTruthy();
    fireEvent.click(manageSeats);
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(ORGANIZATION_SEAT_MANAGEMENT_URL));
    expect(openUrlMock).toHaveBeenCalledTimes(1);
  });

  it("resolves the new organization-seat strings in each supported locale instead of falling back to keys", () => {
    const keys = [
      "settings.account.organizationRole",
      "settings.account.organizationRoleOwner",
      "settings.account.organizationRoleAdmin",
      "settings.account.organizationRoleMember",
      "settings.account.manageSeats",
      "settings.account.organizationOpenFailed",
    ] as const;

    for (const key of keys) {
      expect(ENGLISH_TRANSLATIONS[key]).not.toBe(key);
      expect(KOREAN_TRANSLATIONS[key]).not.toBe(key);
      expect(KOREAN_TRANSLATIONS[key]).not.toBe(ENGLISH_TRANSLATIONS[key]);
    }

    const { unmount } = render(
      <LocalizationTestProvider language="en">
        <AccountSettingsSection {...accountProps({ billingEntitlement: organizationEntitlement("owner") })} />
      </LocalizationTestProvider>,
    );
    expect(screen.getByText("Organization seat")).toBeTruthy();
    expect(screen.getByText(/organization seat at Acme/i)).toBeTruthy();
    expect(screen.getByText(/Role: Owner/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Manage seats$/i })).toBeTruthy();
    expect(screen.queryByText("settings.account.manageSeats")).toBeNull();
    unmount();

    render(
      <LocalizationTestProvider language="ko">
        <AccountSettingsSection {...accountProps({ billingEntitlement: organizationEntitlement("owner") })} />
      </LocalizationTestProvider>,
    );
    expect(screen.getByText("조직 좌석")).toBeTruthy();
    expect(screen.getByText(/Acme 조직 좌석으로 앱을 사용하고 있어요/)).toBeTruthy();
    expect(screen.getByText(/역할: 소유자/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^좌석 관리$/ })).toBeTruthy();
    expect(screen.queryByText("settings.account.manageSeats")).toBeNull();
    expect(screen.queryByText("settings.account.organizationRole")).toBeNull();
  });
});

describe("AccountSettingsSection organization seat release", () => {
  it("offers the leave control to a member and to an admin, but never to the owner", () => {
    for (const role of ["member", "admin"] as const) {
      const { unmount } = render(<AccountSettingsSection {...accountProps({
        billingEntitlement: organizationEntitlement(role),
        onReleaseOrganizationSeat: vi.fn(),
      })} />);
      expect(screen.getByText("Leave this organization")).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Leave$/ })).toBeTruthy();
      unmount();
    }

    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("owner"),
      onReleaseOrganizationSeat: vi.fn(),
    })} />);
    expect(screen.queryByText("Leave this organization")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Leave$/ })).toBeNull();
  });

  it("does not offer the leave control on an individual entitlement", () => {
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: individualEntitlement,
      onReleaseOrganizationSeat: vi.fn(),
    })} />);

    expect(screen.queryByText("Leave this organization")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Leave$/ })).toBeNull();
  });

  it("requires a second confirmation before releasing and releases nothing when cancelled", () => {
    const onReleaseOrganizationSeat = vi.fn();
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("member"),
      onReleaseOrganizationSeat,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Leave$/ }));
    expect(onReleaseOrganizationSeat).not.toHaveBeenCalled();
    expect(screen.getByText(/Leaving ends your access right away/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(onReleaseOrganizationSeat).not.toHaveBeenCalled();
    expect(screen.queryByText(/Leaving ends your access right away/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Leave$/ })).toBeTruthy();
  });

  it("releases the member's own seat and refreshes the entitlement on success", async () => {
    const onReleaseOrganizationSeat = vi.fn().mockResolvedValue({ outcome: "released" });
    const onRefreshCloudStatus = vi.fn().mockResolvedValue(undefined);
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("member"),
      onReleaseOrganizationSeat,
      onRefreshCloudStatus,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Leave$/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Yes, leave$/ }));
    });

    expect(onReleaseOrganizationSeat).toHaveBeenCalledWith("seat-1");
    expect(onReleaseOrganizationSeat).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onRefreshCloudStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports an unconfirmed release as pending and does not refresh the entitlement", async () => {
    const onReleaseOrganizationSeat = vi.fn().mockResolvedValue({ outcome: "pending", error: "still pending" });
    const onRefreshCloudStatus = vi.fn().mockResolvedValue(undefined);
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("member"),
      onReleaseOrganizationSeat,
      onRefreshCloudStatus,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Leave$/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Yes, leave$/ }));
    });

    expect(screen.getByRole("alert").textContent).toContain("was not confirmed as released");
    expect(onRefreshCloudStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Yes, leave$/ })).toBeTruthy();
  });

  it("reports a refusal separately from a transport failure", async () => {
    const refused = vi.fn().mockResolvedValue({ outcome: "refused", error: "no" });
    const { unmount } = render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("member"),
      onReleaseOrganizationSeat: refused,
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Leave$/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Yes, leave$/ }));
    });
    expect(screen.getByRole("alert").textContent).toContain("cannot be released here");
    unmount();

    const threw = vi.fn().mockRejectedValue(new Error("offline"));
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("member"),
      onReleaseOrganizationSeat: threw,
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Leave$/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Yes, leave$/ }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Unable to leave the organization");
  });

  it("localizes every new seat-release string instead of falling back to keys", () => {
    const keys = [
      "settings.account.releaseSeatTitle",
      "settings.account.releaseSeat",
      "settings.account.releaseSeatDescription",
      "settings.account.releaseSeatConfirmDescription",
      "settings.account.releaseSeatConfirm",
      "settings.account.releaseSeatCancel",
      "settings.account.releaseSeatWorking",
      "settings.account.releaseSeatPending",
      "settings.account.releaseSeatRefused",
      "settings.account.releaseSeatFailed",
    ] as const;

    for (const key of keys) {
      expect(ENGLISH_TRANSLATIONS[key]).not.toBe(key);
      expect(KOREAN_TRANSLATIONS[key]).not.toBe(key);
      expect(KOREAN_TRANSLATIONS[key]).not.toBe(ENGLISH_TRANSLATIONS[key]);
    }

    render(
      <LocalizationTestProvider language="ko">
        <AccountSettingsSection {...accountProps({
          billingEntitlement: organizationEntitlement("member"),
          onReleaseOrganizationSeat: vi.fn(),
        })} />
      </LocalizationTestProvider>,
    );
    expect(screen.getByText("이 조직에서 나가기")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^나가기$/ }));
    expect(screen.getByRole("button", { name: /^네, 나갈게요$/ })).toBeTruthy();
    expect(screen.queryByText("settings.account.releaseSeatConfirm")).toBeNull();
  });
});
