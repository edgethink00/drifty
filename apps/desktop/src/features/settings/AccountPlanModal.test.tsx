// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountPlanModal } from "./AccountPlanModal";
import { AccountSettingsSection, type AccountSettingsSectionProps } from "./AccountSettingsSection";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ hasRequiredAccountAuth: false, user: null }) }));
afterEach(cleanup);
const defaults: AccountSettingsSectionProps = {
  billingCheckoutLoadingInterval: null, billingEntitlementError: null, billingEntitlementLockedReason: "billing_missing",
  billingEntitlementStatus: "locked", billingPlansDisabled: false, billingPortalLoading: false,
  couponRedemption: null, couponRedemptionErrorCode: null, couponRedemptionLoading: false,
  cloudDeviceAccess: null, cloudDeviceActionError: null, cloudDeviceRevokingId: null, cloudDevices: [],
  cloudStatusRefreshing: false, currentBillingPlan: "free", isSupabaseConfigured: true,
  shouldShowCloudCheckoutPlans: true, userEmail: "alex@example.test", onManageCloudBilling: vi.fn(),
  onRefreshCloudStatus: vi.fn(), onRedeemTrialCoupon: vi.fn(), onRevokeCloudDevice: vi.fn(),
  onSignIn: vi.fn(), onStartCloudSetup: vi.fn(),
};
describe("Account plan comparison", () => {
  it("opens comparison only on request, selects yearly, and restores focus", async () => {
    const checkout = vi.fn();
    render(<AccountSettingsSection {...defaults} onStartCloudSetup={checkout} />);
    expect(screen.queryByText("$0")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const opener = screen.getByRole("button", {name: "Change plan"});
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", {name: "Change plan"});
    expect(within(dialog).getByText("$0")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("radio", {name: /yearly/i}));
    fireEvent.click(within(dialog).getByRole("button", {name: /choose drifty pro plan/i}));
    expect(checkout).toHaveBeenCalledWith("yearly");
    fireEvent.keyDown(window, {key: "Escape"});
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
  it("keeps a trial distinct from Free and shows checkout errors inside the dialog", () => {
    const props = {...defaults, billingEntitlementStatus: "trialing" as const};
    const {rerender} = render(<AccountSettingsSection {...props} />);
    expect(screen.getByText("Free trial")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Change plan"}));
    rerender(<AccountSettingsSection {...props} billingActionError="Checkout could not be opened." />);
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("Checkout could not be opened");
    expect(within(screen.getByRole("dialog")).queryByText("Current plan")).toBeNull();
  });
  it("keeps billing management directly accessible without starting checkout", async () => {
    const manage = vi.fn(); const checkout = vi.fn();
    render(<AccountSettingsSection {...defaults} currentBillingPlan="individual" billingEntitlementStatus="active"
      shouldShowCloudCheckoutPlans={false} onManageCloudBilling={manage} onStartCloudSetup={checkout} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", {name: "Manage billing"})); });
    expect(manage).toHaveBeenCalledTimes(1);
    expect(checkout).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("blocks duplicate actions during checkout and exposes update recovery", () => {
    const aiSetup = vi.fn(); const update = vi.fn();
    const props = {...defaults, onOpenAiSetup: aiSetup, onCheckForUpdates: update};
    const {rerender} = render(<AccountSettingsSection {...props} />);
    fireEvent.click(screen.getByRole("button", {name: "Change plan"}));
    rerender(<AccountSettingsSection {...props} billingCheckoutLoadingInterval="monthly" />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    const free = screen.getByRole("button", {name: "Open AI setup"});
    expect(free).toHaveProperty("disabled", true);
    fireEvent.click(free); expect(aiSetup).not.toHaveBeenCalled();
    rerender(<AccountSettingsSection {...props} billingActionError="Update Drifty to confirm the current price." billingActionErrorCode="pricing_revision_mismatch" />);
    fireEvent.click(screen.getByRole("button", {name: "Check for updates"}));
    expect(update).toHaveBeenCalledTimes(1);
    rerender(<AccountSettingsSection {...props} billingCheckoutLoadingInterval="monthly" />);
    fireEvent.keyDown(window, {key: "Escape"});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("localizes the summary and dialog and closes before navigating to AI setup", () => {
    const aiSetup = vi.fn();
    render(<LocalizationTestProvider><AccountSettingsSection {...defaults} onOpenAiSetup={aiSetup} /></LocalizationTestProvider>);
    fireEvent.click(screen.getByRole("button", {name: "플랜 변경"}));
    expect(screen.getByRole("dialog", {name: "플랜 변경"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "AI 설정 열기"}));
    expect(aiSetup).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});


describe("Account plan hardening", () => {
  it("does not offer billing management for the real trial projection from App", () => {
    render(<AccountSettingsSection {...defaults} billingEntitlementStatus="trialing" currentBillingPlan="individual" shouldShowCloudCheckoutPlans={false} />);
    expect(screen.getByText("Free trial")).toBeTruthy();
    expect(screen.queryByRole("button", {name: "Manage billing"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "Change plan"}));
    expect(screen.getByRole("button", {name: /choose drifty pro plan/i})).toHaveProperty("disabled", false);
  });
  it("never calls an unconfirmed subscription Free or adds a refresh action", () => {
    const refresh = vi.fn();
    const props = {...defaults, currentBillingPlan: null, billingEntitlementStatus: null, billingEntitlementLockedReason: null, onRefreshCloudStatus: refresh, onOpenAiSetup: vi.fn()};
    const {rerender} = render(<AccountSettingsSection {...props} cloudStatusRefreshing />);
    expect(screen.getByText("Checking")).toBeTruthy();
    expect(screen.queryByText("Free")).toBeNull();
    rerender(<AccountSettingsSection {...props} billingEntitlementError="Offline" />);
    expect(screen.getByText("Checking")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Change plan"}));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", {name: /choose drifty pro plan/i})).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", {name: "Open AI setup"})).toHaveProperty("disabled", false);
    expect(within(dialog).queryByRole("button", {name: "Refresh plan"})).toBeNull();
    expect(screen.queryByText("Offline")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("explains browser confirmation and preserves the guard when comparison is reopened", () => {
    render(<AccountSettingsSection {...defaults} billingCheckoutAwaitingConfirmation billingPlansDisabled />);
    expect(screen.getByRole("status").textContent).toContain("Complete checkout in your browser");
    fireEvent.click(screen.getByRole("button", {name: "Change plan"}));
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toContain("Complete checkout");
    expect(screen.getByRole("button", {name: /choose drifty pro plan/i})).toHaveProperty("disabled", true);
    fireEvent.keyDown(window, {key: "Escape"});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("treats subscriber prices as comparison and guards repeated portal calls across reopen", async () => {
    let finish!: () => void;
    const manage = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<AccountSettingsSection {...defaults} billingEntitlementStatus="active" currentBillingPlan="individual" onManageCloudBilling={manage} />);
    fireEvent.click(screen.getByRole("button", {name: "Change plan"}));
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText(/Prices below are for new subscriptions/)).toBeTruthy();
    const manageButton = within(screen.getByRole("dialog")).getByRole("button", {name:"Manage billing"});
    fireEvent.click(manageButton); fireEvent.click(manageButton);
    fireEvent.keyDown(window, {key:"Escape"});
    fireEvent.click(screen.getByRole("button", {name:"Change plan"}));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name:"Manage billing"}));
    expect(manage).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
  });
  it("closes before an expired session launches login and retains the selected interval", async () => {
    // React commits the close at the end of the click, before the auth dialog's effects.
    const start = vi.fn();
    render(<AccountSettingsSection {...defaults} hasAuthenticatedSession={false} onStartCloudSetup={start} />);
    fireEvent.click(screen.getByRole("button", {name:"Change plan"}));
    fireEvent.click(screen.getByRole("radio", {name:/yearly/i}));
    await act(async () => { fireEvent.click(screen.getByRole("button", {name:/choose drifty pro plan/i})); });
    expect(start).toHaveBeenCalledWith("yearly");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("provides update recovery even without an error message and closes before opening it", () => {
    const update = vi.fn();
    render(<AccountSettingsSection {...defaults} billingActionErrorCode="pricing_revision_mismatch" onCheckForUpdates={update} />);
    fireEvent.click(screen.getByRole("button", {name:"Change plan"}));
    fireEvent.click(screen.getByRole("button", {name:"Check for updates"}));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("cycles Tab explicitly when the browser skips buttons by default", async () => {
    render(<AccountSettingsSection {...defaults} />);
    fireEvent.click(screen.getByRole("button", {name: "Change plan"}));
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", {name: "Dismiss plan selection"});
    await waitFor(() => expect(document.activeElement).toBe(close));
    fireEvent.keyDown(close, {key: "Tab"});
    expect(document.activeElement).toBe(within(dialog).getByRole("radio", {name: /monthly/i}));
    fireEvent.keyDown(document.activeElement!, {key: "Tab", shiftKey: true});
    expect(document.activeElement).toBe(close);
  });

  it("selects billing intervals with arrows without starting checkout", () => {
    const checkout = vi.fn();
    render(<AccountSettingsSection {...defaults} onStartCloudSetup={checkout} />);
    fireEvent.click(screen.getByRole("button", {name:"Change plan"}));
    fireEvent.keyDown(screen.getByRole("radio", {name:/monthly/i}), {key:"ArrowRight"});
    const yearly = screen.getByRole("radio", {name:/yearly/i});
    expect(yearly.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(yearly);
    expect(checkout).not.toHaveBeenCalled();
  });
});

function MotionHarness({ onClosed = () => {} }: { readonly onClosed?: () => void }) {
  const [open, setOpen] = useState(true);
  const close = () => { setOpen(false); onClosed(); };
  return (
    <>
      <button onClick={close}>Close plans</button>
      <AccountPlanModal open={open} busy={false} onClose={close}><p>Plan comparison</p></AccountPlanModal>
    </>
  );
}

describe("Account plan dialog motion", () => {
  const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
    vi.stubGlobal("cancelAnimationFrame", window.clearTimeout);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("portals the panel into its own presence boundary so shared modal motion applies", () => {
    render(<AccountPlanModal open busy={false} onClose={() => {}}><p>Plan comparison</p></AccountPlanModal>);
    tick(20);

    // A boundary left outside the portal cannot match the descendant-scoped
    // motion rules, which is how this dialog shipped without entry or exit.
    const boundary = screen.getByRole("dialog").closest("[data-modal-presence]");
    expect(boundary?.getAttribute("data-modal-presence")).toBe("open");
    expect(boundary?.querySelector(".account-plan-modal.modal-shell")).not.toBeNull();
  });

  it("holds the panel, page scroll lock, and app inert state through the exit transition", () => {
    render(<div id="root"><MotionHarness /></div>);
    tick(20);
    const appRoot = document.getElementById("root");
    expect(document.body.style.overflow).toBe("hidden");
    expect(appRoot?.inert).toBe(true);

    fireEvent.click(screen.getByText("Close plans"));

    expect(screen.getByRole("dialog").closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("exiting");
    expect(document.body.style.overflow).toBe("hidden");

    tick(300);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(appRoot?.inert).toBe(false);
  });

  it("blocks a duplicate dismissal while the panel is exiting", () => {
    const onClosed = vi.fn();
    render(<MotionHarness onClosed={onClosed} />);
    tick(20);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss plan selection" }));
    fireEvent.keyDown(window, { key: "Escape" });
    tick(300);

    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
