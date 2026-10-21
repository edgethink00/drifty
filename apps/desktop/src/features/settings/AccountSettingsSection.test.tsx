// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSettingsSection, ORGANIZATION_SEAT_MANAGEMENT_URL, ORGANIZATION_SEAT_MANAGEMENT_URL_KO, type AccountSettingsSectionProps } from "./AccountSettingsSection";
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
  it.each(["failed check", "checking"] as const)("keeps Upgrade to Pro unavailable until the plan is verified (%s)", (state) => {
    const props = accountProps({
      billingEntitlement: {
        ...individualEntitlement, status: "locked", canUseApp: false, lockedReason: "billing_missing",
        trialActivation: { state: "available", startedAt: null, endsAt: null },
      },
      billingEntitlementStatus: "locked",
      billingEntitlementLockedReason: "billing_missing",
      billingEntitlementError: state === "checking" ? null : "Plan check unavailable.",
      cloudStatusRefreshing: state === "checking",
    });
    render(<AccountSettingsSection {...props} />);
    expect(screen.queryByText("7-day free trial available")).toBeNull();
    const upgrade = screen.getByRole("button", { name: "Upgrade to Pro" });
    expect(upgrade).toHaveProperty("disabled", true);
    fireEvent.click(upgrade);
    expect(props.onUpgradeToPro).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
    expect(screen.queryByText(/Plan check unavailable|subscription status has not been confirmed/i)).toBeNull();
    expect(props.onRefreshCloudStatus).not.toHaveBeenCalled();
  });

  it("shows one plan action per account state and no plan-change dialog", () => {
    const trialEnded = accountProps({
      billingEntitlement: { ...individualEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
      billingEntitlementStatus: "locked",
      billingEntitlementLockedReason: "trial_expired",
    });
    render(<AccountSettingsSection {...trialEnded} />);
    const actions = screen.getByText("Pro trial ended. Local tracking and on-device AI remain free.")
      .closest(".account-plan-summary")?.querySelector(".account-plan-summary__actions");
    expect(Array.from(actions?.querySelectorAll("button") ?? []).map((button) => button.querySelector(".action-label__live")?.textContent ?? button.textContent)).toEqual(["Upgrade to Pro"]);
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(trialEnded.onUpgradeToPro).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();

    render(<AccountSettingsSection {...accountProps()} />);
    expect(screen.getByRole("button", { name: "Manage billing" }).className).toContain("primary");
    expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
  });

  it("keeps an explicit billing action failure visible while a background read failure stays quiet", () => {
    const props = accountProps({ billingEntitlementError: "Background read failed." });
    const view = render(<AccountSettingsSection {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage billing" }));
    view.rerender(<AccountSettingsSection {...props} billingActionError="Portal request failed." />);
    expect(screen.getByText("Billing could not be opened. Please try again.")).toBeTruthy();
    expect(screen.queryByText("Background read failed.")).toBeNull();
  });

  it("leaves device sync and the device list to Sync, and points a full device limit there", () => {
    render(<AccountSettingsSection {...accountProps({
      billingEntitlementStatus: "locked", billingEntitlementLockedReason: "device_limit_reached",
    })} />);

    expect(screen.getByText(/remove an old device in Sync settings/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Manage billing$/i })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Toggle device sync" })).toBeNull();
    expect(screen.queryByRole("region", { name: /^Your devices$/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Devices/i })).toBeNull();
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
      cloudStatusRefreshing: false,
      isSupabaseConfigured: true,
      userEmail: null,
      onManageCloudBilling: vi.fn(),
      onRefreshCloudStatus: vi.fn(),
      onRedeemTrialCoupon: vi.fn(),
      onSignIn,
      onUpgradeToPro: vi.fn(),
    };

    render(<AccountSettingsSection {...props} />);

    // Sign-in lives in the plan row beside the account line; the promo row has its own.
    const summary = screen.getByText("Not signed in").closest(".account-plan-summary") as HTMLElement;
    expect(within(summary).getByText("On-device AI and local tracking, free on your device.")).toBeTruthy();
    fireEvent.click(within(summary).getByRole("button", { name: /^Sign in$/i }));

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
      cloudStatusRefreshing: false,
      isSupabaseConfigured: true,
      userEmail: "alex@example.com",
      onDeleteAccount,
      onManageCloudBilling: vi.fn(),
      onRefreshCloudStatus: vi.fn(),
      onRedeemTrialCoupon: vi.fn(),
      onSignIn: vi.fn(),
      onUpgradeToPro: vi.fn(),
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
      cloudStatusRefreshing: false,
      isSupabaseConfigured: true,
      userEmail: "alex@example.com",
      onManageCloudBilling: vi.fn(),
      onRefreshCloudStatus: vi.fn(),
      onRedeemTrialCoupon,
      onSignIn: vi.fn(),
      onUpgradeToPro: vi.fn(),
    };

    const { rerender } = render(<AccountSettingsSection {...props} />);
    // The promo field is always open in the plan card; no disclosure step.
    const codeInput = screen.getByRole("textbox", { name: /Drifty promo code/i });

    fireEvent.change(codeInput, { target: { value: " drft-test-2026 " } });
    expect(screen.queryByText(/offline promo code/i)).toBeNull();
    expect(screen.getByText("Promo code")).toBeTruthy();
    expect(codeInput.getAttribute("placeholder")).toBe("DRFT-XXXX");

    fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));

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

    expect(couponResult().textContent).toContain("Code applied");
    // One code per account: the applied row replaces the field.
    expect(screen.queryByRole("textbox", { name: /Drifty promo code/i })).toBeNull();

    rerender(
      <AccountSettingsSection
        {...props}
        couponRedemptionErrorCode="coupon_rate_limited"
      />,
    );

    const alert = screen.getByRole("alert");
    const retryInput = screen.getByRole("textbox", { name: /Drifty promo code/i });
    expect(alert.textContent).toContain("Try again in 15 minutes");
    expect(retryInput.getAttribute("aria-invalid")).toBe("true");
    expect(retryInput.getAttribute("aria-describedby")).toBe(alert.id);

    // The error describes the code that was sent; editing the field clears it.
    fireEvent.change(retryInput, { target: { value: "DRFT-OTHER-2026" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(retryInput.getAttribute("aria-invalid")).toBeNull();
  });

  it("hides the promo code for an active subscription and keeps billing management", async () => {
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
        cloudStatusRefreshing={false}
        isSupabaseConfigured={true}
        userEmail="alex@example.com"
        onManageCloudBilling={onManageCloudBilling}
        onRefreshCloudStatus={vi.fn()}
        onRedeemTrialCoupon={vi.fn()}
        onSignIn={vi.fn()}
        onUpgradeToPro={vi.fn()}
      />,
    );

    // The server refuses trial codes for an active subscription, so the row
    // is not offered at all.
    expect(screen.queryByText("Promo code")).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Drifty promo code/i })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Manage billing$/i })); });
    expect(onManageCloudBilling).toHaveBeenCalledTimes(1);
  });

  it("reports active promotion access instead of offering another code", () => {
    render(
      <AccountSettingsSection
        {...couponTestProps()}
        billingEntitlementLockedReason={null}
        billingEntitlementStatus="trialing"
        billingEntitlement={{
          plan: "individual",
          status: "trialing",
          canUseApp: true,
          trialEndsAt: "2026-10-23T00:00:00.000Z",
          currentPeriodEnd: null,
          accessSource: "promotion",
        }}
      />,
    );
    const promoRow = screen.getByText("Promo code").closest(".settings-row") as HTMLElement;

    expect(within(promoRow).getByText(/Promo access is active through Oct 23, 2026/)).toBeTruthy();
    expect(within(promoRow).getByText("Applied")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /Drifty promo code/i })).toBeNull();
    // No field, so no label pointing at one.
    expect(promoRow.querySelector("label")).toBeNull();
  });

  it("recovers a blocked payment from the plan summary instead of starting checkout", async () => {
    const onManageCloudBilling = vi.fn();
    const onUpgradeToPro = vi.fn();

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
        cloudStatusRefreshing={false}
        isSupabaseConfigured={true}
        userEmail="alex@example.com"
        onManageCloudBilling={onManageCloudBilling}
        onRefreshCloudStatus={vi.fn()}
        onRedeemTrialCoupon={vi.fn()}
        onSignIn={vi.fn()}
        onUpgradeToPro={onUpgradeToPro}
      />,
    );

    expect(screen.getByText(/Activity tracking continues. Update payment to resume Cloud AI/i)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Fix billing$/i })); });
    expect(onManageCloudBilling).toHaveBeenCalledTimes(1);
    expect(onUpgradeToPro).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Upgrade to Pro$/ })).toBeNull();
  });

  it("places Promo code as the plan card row right after the plan summary", () => {
    render(<AccountSettingsSection {...couponTestProps()} />);
    const planBlock = screen.getByRole("heading", { name: /^Account$/ }).closest(".settings-block");
    const promoRow = screen.getByText("Promo code").closest(".settings-row");

    expect(promoRow?.parentElement).toBe(planBlock);
    expect(promoRow?.previousElementSibling?.classList.contains("account-plan-summary")).toBe(true);
  });

  it("explains an incomplete promo code instead of disabling the submit button", () => {
    const onRedeemTrialCoupon = vi.fn();
    render(<AccountSettingsSection {...couponTestProps()} onRedeemTrialCoupon={onRedeemTrialCoupon} />);
    const submit = screen.getByRole("button", { name: /^Apply$/i }) as HTMLButtonElement;

    expect(submit.disabled).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /Drifty promo code/i }), { target: { value: "DRFT" } });
    fireEvent.click(submit);

    expect(onRedeemTrialCoupon).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Check the code and try again.");
  });

  it("offers sign-in in the promo row when no account is signed in", () => {
    const onSignIn = vi.fn();
    render(<AccountSettingsSection {...couponTestProps()} userEmail={null} hasSignedInAccount={false} onSignIn={onSignIn} />);
    const promoRow = screen.getByText("Promo code").closest(".settings-row");

    expect(screen.queryByRole("textbox", { name: /Drifty promo code/i })).toBeNull();
    fireEvent.click(within(promoRow as HTMLElement).getByRole("button", { name: /^Sign in$/i }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("folds pasted typographic dashes and full-width letters into the stored code form", () => {
    const onRedeemTrialCoupon = vi.fn();
    render(<AccountSettingsSection {...couponTestProps()} onRedeemTrialCoupon={onRedeemTrialCoupon} />);
    const codeInput = screen.getByRole("textbox", { name: /Drifty promo code/i });

    fireEvent.change(codeInput, { target: { value: " ｄｒｆｔ–test—2026 " } });
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));

    expect(onRedeemTrialCoupon).toHaveBeenCalledWith("DRFT-TEST-2026");
  });

  it("moves focus to the result when a submitted code is applied", () => {
    const props = couponTestProps();
    const { rerender } = render(<AccountSettingsSection {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Drifty promo code/i }), { target: { value: "DRFT-TEST-2026" } });
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));

    rerender(
      <AccountSettingsSection
        {...props}
        couponRedemption={{ status: "redeemed", grantedDays: 30, trialEndsAt: "2026-10-23T00:00:00.000Z", redeemedAt: "2026-09-23T00:00:00.000Z" }}
      />,
    );

    const result = couponResult();
    expect(result.textContent).toContain("Code applied");
    expect(document.activeElement).toBe(result);
  });

  it("keeps consistent spacing between Account settings sections", () => {
    const styles = readFileSync(desktopSourcePath("src/features/settings/AccountSettingsSection.css"), "utf8");
    const sharedPlanStyles = readFileSync(desktopSourcePath("src/styles/settings-polish.css"), "utf8");
    const sectionRule = cssRule(styles, ".content--settings .settings-section--account");
    const stackedRowRule = cssRule(styles, ".content--settings .settings-section--account .settings-row--stacked-action");
    const stackedControlRule = cssRule(styles, ".content--settings .settings-section--account .settings-row--stacked-action > .ctrl");
    const sharedPlanSuiteRule = cssRule(sharedPlanStyles, ".individual-plan-suite");
    const sharedPlanIntervalsRule = cssRule(sharedPlanStyles, ".individual-plan-intervals");
    const sharedPlanCardsRule = cssRule(sharedPlanStyles, ".individual-plan-cards");
    const sharedSectionHeadingRule = cssRule(sharedPlanStyles, ".content--settings .settings-block > h3");
    const dangerLabelRule = cssRule(styles, ".content--settings .settings-section--account .settings-block--danger-zone .lbl");

    expect(sectionRule).toContain("gap: var(--space-5);");
    expect(stackedRowRule).toContain("display: grid;");
    expect(stackedRowRule).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(stackedControlRule).toContain("justify-self: start;");
    expect(sharedPlanSuiteRule).toContain("gap: var(--space-2);");
    expect(sharedPlanSuiteRule).toContain("max-width: 42rem;");
    expect(sharedPlanIntervalsRule).toContain("justify-self: start;");
    expect(sharedPlanIntervalsRule).toContain("margin: 0;");
    expect(sharedPlanCardsRule).toContain("margin: 0;");
    expect(sharedSectionHeadingRule).toContain("color: var(--text-soft);");
    expect(styles).not.toContain("settings-row--coupon");
    expect(dangerLabelRule).toContain("color: var(--warn);");
    expect(styles).not.toContain(".settings-block--danger-zone h3");
  });
  it("keeps the trial-code action on the shared Settings control language", () => {
    const styles = readFileSync(desktopSourcePath("src/features/settings/TrialCouponRedemption.css"), "utf8");
    const markup = readFileSync(desktopSourcePath("src/features/settings/TrialCouponRedemption.tsx"), "utf8");

    expect(markup).not.toContain("settings-btn--primary");
    expect(styles).not.toContain("background: var(--accent);");
    // The joined code field stands at the Settings action height used by the
    // plan card's own buttons, so the two right-hand controls line up.
    expect(cssRule(styles, ".content--settings .trial-coupon__field")).toContain("height: var(--settings-action-height);");
  });
});

function couponTestProps(): AccountSettingsSectionProps {
  return {
    billingCheckoutLoadingInterval: null,
    billingEntitlementError: null,
    billingEntitlementLockedReason: "trial_expired",
    billingEntitlementStatus: "locked",
    billingPlansDisabled: false,
    billingPortalLoading: false,
    couponRedemption: null,
    couponRedemptionErrorCode: null,
    couponRedemptionLoading: false,
    cloudStatusRefreshing: false,
    isSupabaseConfigured: true,
    userEmail: "alex@example.com",
    onManageCloudBilling: vi.fn(),
    onRefreshCloudStatus: vi.fn(),
    onRedeemTrialCoupon: vi.fn(),
    onSignIn: vi.fn(),
    onUpgradeToPro: vi.fn(),
  };
}

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
    cloudStatusRefreshing: false,
    isSupabaseConfigured: true,
    userEmail: "alex@example.com",
    onManageCloudBilling: vi.fn(),
    onRefreshCloudStatus: vi.fn(),
    onRedeemTrialCoupon: vi.fn(),
    onSignIn: vi.fn(),
    onUpgradeToPro: vi.fn(),
    ...overrides,
  };
}

/** The promo result; the plan row's account line is a live region too. */
function couponResult(): HTMLElement {
  const result = screen.getAllByRole("status").find((element) => element.textContent?.includes("Code applied"));
  if (!result) throw new Error("Expected the applied promo code result");
  return result;
}

describe("AccountSettingsSection organization seat", () => {
  beforeEach(() => {
    openUrlMock.mockReset();
    openUrlMock.mockResolvedValue(undefined);
  });

  it("renders an individual entitlement as a personal plan with no organization row or seat management", () => {
    render(<AccountSettingsSection {...accountProps({ billingEntitlement: individualEntitlement })} />);

    expect(screen.getByText("Drifty Pro")).toBeTruthy();
    expect(screen.getByText("alex@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Manage billing$/i })).toBeTruthy();
    expect(screen.queryByText("Team plan")).toBeNull();
    expect(screen.queryByText(/team plan, so there is nothing/i)).toBeNull();
    expect(screen.queryByText(/Your role:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Manage team$/i })).toBeNull();
  });

  it("shows the organization name and role for a member seat without a management entry point", () => {
    render(<AccountSettingsSection {...accountProps({ billingEntitlement: organizationEntitlement("member") })} />);

    expect(screen.getByText("Team plan")).toBeTruthy();
    expect(screen.getByText(/Your Pro comes from the Acme team plan\./)).toBeTruthy();
    expect(screen.getByText(/Your role: Member\./)).toBeTruthy();
    expect(screen.queryByText("Drifty Pro")).toBeNull();
    expect(screen.queryByText("Manage your Cloud AI subscription and billing.")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Manage billing$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Manage team$/i })).toBeNull();
  });

  it.each(["owner", "admin"] as const)("shows seat management for an %s and opens the organization page", async (role) => {
    render(<AccountSettingsSection {...accountProps({ billingEntitlement: organizationEntitlement(role) })} />);

    const manageSeats = screen.getByRole("button", { name: /^Manage team$/i });
    expect(manageSeats).toBeTruthy();
    fireEvent.click(manageSeats);
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(ORGANIZATION_SEAT_MANAGEMENT_URL));
    expect(openUrlMock).toHaveBeenCalledTimes(1);
  });

  it("opens the Korean team page from the Korean app", async () => {
    render(
      <LocalizationTestProvider language="ko">
        <AccountSettingsSection {...accountProps({ billingEntitlement: organizationEntitlement("admin") })} />
      </LocalizationTestProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^팀 관리$/ }));
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(ORGANIZATION_SEAT_MANAGEMENT_URL_KO));
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
    expect(screen.getByText("Team plan")).toBeTruthy();
    expect(screen.getByText(/the Acme team plan/i)).toBeTruthy();
    expect(screen.getByText(/Your role: Owner\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Manage team$/i })).toBeTruthy();
    expect(screen.queryByText("settings.account.manageSeats")).toBeNull();
    unmount();

    render(
      <LocalizationTestProvider language="ko">
        <AccountSettingsSection {...accountProps({ billingEntitlement: organizationEntitlement("owner") })} />
      </LocalizationTestProvider>,
    );
    expect(screen.getByText("팀 플랜")).toBeTruthy();
    expect(screen.getByText(/Acme 팀 플랜에서 Pro를 받고 있어요/)).toBeTruthy();
    expect(screen.getByText(/내 역할: 소유자\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^팀 관리$/ })).toBeTruthy();
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
      expect(screen.getByText("Leave this team")).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Leave$/ })).toBeTruthy();
      unmount();
    }

    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("owner"),
      onReleaseOrganizationSeat: vi.fn(),
    })} />);
    expect(screen.queryByText("Leave this team")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Leave$/ })).toBeNull();
  });

  it("does not offer the leave control on an individual entitlement", () => {
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: individualEntitlement,
      onReleaseOrganizationSeat: vi.fn(),
    })} />);

    expect(screen.queryByText("Leave this team")).toBeNull();
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
    expect(screen.getByText(/Leaving ends your Pro from this team right away/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(onReleaseOrganizationSeat).not.toHaveBeenCalled();
    expect(screen.queryByText(/Leaving ends your Pro from this team right away/)).toBeNull();
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
    expect(screen.getByRole("alert").textContent).toContain("Unable to leave the team");
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
    expect(screen.getByText("이 팀에서 나가기")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^나가기$/ }));
    expect(screen.getByRole("button", { name: /^네, 나갈게요$/ })).toBeTruthy();
    expect(screen.queryByText("settings.account.releaseSeatConfirm")).toBeNull();
  });
});

describe("AccountSettingsSection organization dissolution", () => {
  it("offers the close control only to the owner", () => {
    for (const role of ["member", "admin"] as const) {
      const { unmount } = render(<AccountSettingsSection {...accountProps({
        billingEntitlement: organizationEntitlement(role),
        onDissolveOrganization: vi.fn(),
      })} />);
      expect(screen.queryByText("Cancel the team plan")).toBeNull();
      unmount();
    }

    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("owner"),
      onDissolveOrganization: vi.fn(),
    })} />);
    expect(screen.getByText("Cancel the team plan")).toBeTruthy();
    const cancelPlan = screen.getByRole("button", { name: /^Cancel team plan$/ });
    // Ending the plan for every member is a danger action, not a seat setting.
    expect(cancelPlan.closest(".settings-block--danger-zone")).toBeTruthy();
    expect(cancelPlan.closest(".settings-block--plans")).toBeNull();
    expect(cancelPlan.className).toContain("danger");
  });

  it("keeps the danger zone for an owner even when account deletion is not offered", () => {
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("owner"),
      onDissolveOrganization: vi.fn(),
      onDeleteAccount: undefined,
    })} />);
    expect(screen.getByRole("button", { name: /^Cancel team plan$/ }).closest(".settings-block--danger-zone")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Delete account$/i })).toBeNull();
  });

  it("does not offer the close control on an individual entitlement", () => {
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: individualEntitlement,
      onDissolveOrganization: vi.fn(),
    })} />);

    expect(screen.queryByText("Cancel the team plan")).toBeNull();
  });

  it("keeps the confirmation disabled until the organization name is typed exactly", () => {
    const onDissolveOrganization = vi.fn();
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("owner"),
      onDissolveOrganization,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Cancel team plan$/ }));
    const confirm = screen.getByRole("button", { name: /^Yes, cancel the plan$/ }) as HTMLButtonElement;
    // This is the only thing standing between one stray click and an
    // immediately cancelled subscription for everyone in the organization.
    expect(confirm.disabled).toBe(true);

    const field = screen.getByLabelText("Team name");
    fireEvent.change(field, { target: { value: "Acm" } });
    expect((screen.getByRole("button", { name: /^Yes, cancel the plan$/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(field, { target: { value: "acme" } });
    expect((screen.getByRole("button", { name: /^Yes, cancel the plan$/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(field, { target: { value: "Acme" } });
    expect((screen.getByRole("button", { name: /^Yes, cancel the plan$/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(onDissolveOrganization).not.toHaveBeenCalled();
  });

  it("dissolves once confirmed and refreshes the entitlement", async () => {
    const onDissolveOrganization = vi.fn().mockResolvedValue({ outcome: "dissolved" });
    const onRefreshCloudStatus = vi.fn().mockResolvedValue(undefined);
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("owner"),
      onDissolveOrganization,
      onRefreshCloudStatus,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Cancel team plan$/ }));
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Acme" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Yes, cancel the plan$/ }));
    });

    expect(onDissolveOrganization).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onRefreshCloudStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cancels without dissolving and forgets the typed name", () => {
    const onDissolveOrganization = vi.fn();
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("owner"),
      onDissolveOrganization,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Cancel team plan$/ }));
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /^Keep the team plan$/ }));
    expect(onDissolveOrganization).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Cancel team plan$/ }));
    expect((screen.getByLabelText("Team name") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: /^Yes, cancel the plan$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns that the subscription may already be cancelled when the reply does not settle", async () => {
    const onDissolveOrganization = vi.fn().mockResolvedValue({ outcome: "pending", error: "not settled" });
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("owner"),
      onDissolveOrganization,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Cancel team plan$/ }));
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Acme" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Yes, cancel the plan$/ }));
    });

    expect(screen.getByRole("alert").textContent).toMatch(/may already be cancelled/);
  });
});

describe("AccountSettingsSection friend invite", () => {
  const invite = {
    code: "DRIFTY-3F9A2C7B1D",
    codeEntryUntil: "2099-01-01T00:00:00.000Z",
    durationDays: 30,
    claimedCount: 0,
    maxClaims: 10,
    expiresAt: "2027-10-08T00:00:00.000Z",
    status: "active" as const,
    claims: [],
  };
  const trialEntitlement = {
    plan: "individual",
    status: "trialing",
    canUseApp: true,
    trialEndsAt: "2026-10-15T00:00:00.000Z",
    currentPeriodEnd: null,
    accessSource: "standard_trial",
  } as const satisfies BillingEntitlement;

  it("shares one redemption between Promo code and the invite card's code tab", async () => {
    const onRedeemTrialCoupon = vi.fn();
    const props = accountProps({
      billingEntitlement: trialEntitlement,
      billingEntitlementStatus: "trialing",
      hasSignedInAccount: true,
      userEmail: "shared-redemption@example.com",
      loadFriendInvite: vi.fn(async () => ({ kind: "ready" as const, invite })),
      onRedeemTrialCoupon,
    });
    const view = render(<AccountSettingsSection {...props} />);

    fireEvent.click(await screen.findByRole("tab", { name: "Enter code" }));
    const panel = screen.getByRole("tabpanel");
    fireEvent.change(within(panel).getByRole("textbox", { name: "Drifty promo code" }), { target: { value: "DRIFTY-3F9A2C7B1D" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Apply" }));
    expect(onRedeemTrialCoupon).toHaveBeenCalledWith("DRIFTY-3F9A2C7B1D");

    // The error belongs to the control the code was typed into.
    view.rerender(<AccountSettingsSection {...props} couponRedemptionErrorCode="coupon_own_invite" />);
    expect(screen.getAllByText(ENGLISH_TRANSLATIONS["settings.account.couponOwnInvite"])).toHaveLength(1);
    expect(within(screen.getByRole("tabpanel")).getByText(ENGLISH_TRANSLATIONS["settings.account.couponOwnInvite"])).toBeTruthy();

    // An applied code is the account's state, so both places report it.
    view.rerender(<AccountSettingsSection {...props} couponRedemption={{
      status: "redeemed",
      grantedDays: 30,
      trialEndsAt: "2026-11-14T00:00:00.000Z",
      redeemedAt: "2026-10-08T00:00:00.000Z",
    }} />);
    expect(screen.getAllByText(/Code applied/)).toHaveLength(2);
    view.unmount();
  });

  it("keeps code entry out of the invite card where codes cannot be redeemed", async () => {
    const props = accountProps({
      hasSignedInAccount: true,
      userEmail: "paid-invite@example.com",
      loadFriendInvite: vi.fn(async () => ({ kind: "ready" as const, invite })),
    });
    const view = render(<AccountSettingsSection {...props} />);
    expect(await screen.findByRole("tab", { name: "Invite" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Enter code" })).toBeNull();
    view.unmount();
  });

  it("shows the signed-in email under the plan name with no separate account block", () => {
    const view = render(<AccountSettingsSection {...accountProps({ billingEntitlement: individualEntitlement })} />);

    const summary = screen.getByText("Drifty Pro").closest(".account-plan-summary") as HTMLElement;
    expect(within(summary).getByText("alex@example.com")).toBeTruthy();
    // The email replaces the generic Pro sentence; it does not sit beside a second account block.
    expect(screen.queryByText("Manage your Cloud AI subscription and billing.")).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Signed-in account$/i })).toBeNull();
    expect(view.container.querySelector(".settings-block--cloud-account")).toBeNull();
    // Settings search for "signed-in account" still lands on this row.
    expect(summary.getAttribute("data-setting-id")).toBe("settings.account.signedIn");
    view.unmount();
  });

  it("keeps a plan status line above the account line", () => {
    const view = render(<AccountSettingsSection {...accountProps({
      billingEntitlement: { ...individualEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
      billingEntitlementStatus: "locked",
      billingEntitlementLockedReason: "trial_expired",
    })} />);

    const summary = screen.getByText("Pro trial ended. Local tracking and on-device AI remain free.").closest(".account-plan-summary") as HTMLElement;
    const lines = Array.from(summary.querySelectorAll(".lbl, .desc")).map((line) => line.textContent);
    expect(lines).toEqual(["Free", "Pro trial ended. Local tracking and on-device AI remain free.", "alex@example.com"]);
    view.unmount();
  });

  it("places the invite card after the plan and account row, with no public profile block", async () => {
    const props = accountProps({
      billingEntitlement: trialEntitlement,
      billingEntitlementStatus: "trialing",
      hasSignedInAccount: true,
      userEmail: "invite-order@example.com",
      loadFriendInvite: vi.fn(async () => ({ kind: "ready" as const, invite })),
    });
    const view = render(<AccountSettingsSection {...props} />);
    await screen.findByRole("tab", { name: "Invite" });
    const signedIn = view.container.querySelector('[data-setting-id="settings.account.signedIn"]')!;
    const card = view.container.querySelector(".settings-block--friend-invite")!;
    expect(signedIn.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.container.querySelector('[data-setting-id="settings.account.publicProfile"]')).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Public profile$/i })).toBeNull();
    view.unmount();
  });
});

describe("AccountSettingsSection pending and failed plan actions keep their place", () => {
  beforeEach(() => {
    openUrlMock.mockReset();
  });

  function planRowLines(container: HTMLElement): (string | null)[] {
    const summary = container.querySelector(".account-plan-summary") as HTMLElement;
    return Array.from(summary.querySelectorAll(":scope > div:first-child > *")).map((line) => line.textContent);
  }

  function sectionChildren(container: HTMLElement): string[] {
    return Array.from(container.querySelector(".settings-section--account")?.children ?? []).map((child) => child.className);
  }

  it("shows Manage billing's progress only inside its button", () => {
    const idle = render(<AccountSettingsSection {...accountProps({ billingEntitlement: individualEntitlement })} />);
    const idleChildren = sectionChildren(idle.container);
    const idleLines = planRowLines(idle.container);
    idle.unmount();

    const view = render(<AccountSettingsSection {...accountProps({ billingEntitlement: individualEntitlement, billingPortalLoading: true })} />);
    const button = screen.getByRole("button", { name: "Opening…" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".action-label__spinner")).toBeTruthy();
    expect(screen.queryByText(/Opening billing in your browser/)).toBeNull();
    // No status line is inserted between the account card and the invite card.
    expect(sectionChildren(view.container)).toEqual(idleChildren);
    expect(planRowLines(view.container)).toEqual(idleLines);
  });

  it("uses one short opening label for every billing button that opens the browser", () => {
    expect(ENGLISH_TRANSLATIONS["billing.plan.opening"]).toBe("Opening…");
    expect(KOREAN_TRANSLATIONS["billing.plan.opening"]).toBe("여는 중…");
    for (const retired of ["settings.account.billingOpening", "billing.plan.openingBilling", "billing.plan.openingCheckout", "dashboard.aiRecovery.openingBilling"]) {
      expect(Object.keys(ENGLISH_TRANSLATIONS)).not.toContain(retired);
    }
  });

  it("shows Upgrade to Pro working while checkout opens, like Manage billing", () => {
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: { ...individualEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
      billingEntitlementStatus: "locked",
      billingEntitlementLockedReason: "trial_expired",
      billingCheckoutLoadingInterval: "monthly",
    })} />);
    const button = screen.getByRole("button", { name: "Opening…" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".action-label__spinner")).toBeTruthy();
    expect(Array.from(button.querySelectorAll(".action-label__size")).map((size) => size.textContent)).toEqual(["Upgrade to Pro", "Opening…"]);
  });

  it("puts a checkout waiting in the browser in the account line of the plan row", () => {
    const view = render(<AccountSettingsSection {...accountProps({
      billingEntitlement: { ...individualEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
      billingEntitlementStatus: "locked",
      billingEntitlementLockedReason: "trial_expired",
      billingCheckoutAwaitingConfirmation: true,
    })} />);

    const status = screen.getByText("Complete checkout in your browser.");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.classList.contains("account-plan-summary__account")).toBe(true);
    expect(planRowLines(view.container)).toEqual([
      "Free",
      "Pro trial ended. Local tracking and on-device AI remain free.",
      "Complete checkout in your browser.",
    ]);
    expect(view.container.querySelector(".settings-section--account > p")).toBeNull();
  });

  it("reports a failed billing action beside Manage billing instead of above the plan row", () => {
    const props = accountProps({ billingEntitlement: individualEntitlement });
    const view = render(<AccountSettingsSection {...props} />);
    const line = view.container.querySelector(".account-plan-summary__account") as HTMLElement;
    expect(line.textContent).toBe("alex@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Manage billing" }));
    view.rerender(<AccountSettingsSection {...props} billingActionError="portal_session_failed (502)" />);

    // The same live line changes its text; the backend's wording stays out of
    // the visible line, in its title and for screen readers.
    expect(view.container.querySelector(".account-plan-summary__account")).toBe(line);
    expect(line.getAttribute("role")).toBe("status");
    expect(line.firstChild?.textContent).toBe("Billing could not be opened. Please try again.");
    expect(line.querySelector(".sr-only")?.textContent).toBe(" portal_session_failed (502)");
    expect(line.getAttribute("title")).toBe("Billing could not be opened. Please try again.\nportal_session_failed (502)");
    expect(line.closest(".account-plan-summary")).toBeTruthy();
    // The notice above the plan row is only for locked states, so the button does not drop.
    expect(view.container.querySelector(".account-plan-notice")).toBeNull();
    expect(planRowLines(view.container)).toHaveLength(2);
  });

  it("leaves a checkout failure to the Pro sheet that started it", () => {
    const props = accountProps({
      billingEntitlement: { ...individualEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
      billingEntitlementStatus: "locked",
      billingEntitlementLockedReason: "trial_expired",
    });
    const view = render(<AccountSettingsSection {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    view.rerender(<AccountSettingsSection {...props} billingActionError="Checkout could not open." />);

    // The sheet reports it in its own footer; the account line keeps the email
    // instead of holding the sheet's failure after the sheet is closed.
    expect(view.container.querySelector(".account-plan-summary__account")?.textContent).toBe("alex@example.com");
    expect(screen.queryByText("Checkout could not open.")).toBeNull();
  });

  it("reports a failed team page in the plan row that holds Manage team", async () => {
    openUrlMock.mockRejectedValue(new Error("no browser"));
    const view = render(<AccountSettingsSection {...accountProps({ billingEntitlement: organizationEntitlement("admin") })} />);
    const before = planRowLines(view.container).length;

    fireEvent.click(screen.getByRole("button", { name: /^Manage team$/ }));

    const line = await screen.findByText("Couldn't open team management. Please try again.");
    expect(line.getAttribute("role")).toBe("status");
    expect(line.closest(".account-plan-summary")).toBeTruthy();
    expect(planRowLines(view.container)).toHaveLength(before);
    expect(view.container.querySelector(".settings-section--account > p")).toBeNull();
  });

  it("reports a failed seat release in the release row's description line", async () => {
    render(<AccountSettingsSection {...accountProps({
      billingEntitlement: organizationEntitlement("member"),
      onReleaseOrganizationSeat: vi.fn().mockRejectedValue(new Error("offline")),
    })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Leave$/ }));
    const row = screen.getByText("Leave this team").closest(".account-organization-seat-release") as HTMLElement;
    const linesBefore = row.querySelectorAll(":scope > div:first-child > *").length;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Yes, leave$/ }));
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Unable to leave the team");
    expect(row.contains(alert)).toBe(true);
    expect(row.querySelectorAll(":scope > div:first-child > *")).toHaveLength(linesBefore);
    expect(row.parentElement?.querySelector(":scope > .account-plan-notice__error")).toBeNull();
    // The confirmation text stays laid out (hidden) in the same cell, so a
    // shorter failure line cannot shrink the row and pull the buttons up.
    const held = row.querySelector(".settings-row-description > [data-hidden]");
    expect(held?.textContent).toMatch(/Leaving ends your Pro from this team right away/);
    expect(held?.getAttribute("aria-hidden")).toBe("true");
  });
});

