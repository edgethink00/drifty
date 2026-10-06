// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock } from "./AiSetupPanel.testHarness";
import { ANALYSIS_AI_SETUP_STORAGE_KEY, DEFAULT_ANALYSIS_AI_SETUP } from "./analysisModelSetup";
import { DEFAULT_LOCAL_AI_SETUP, LOCAL_AI_SETUP_STORAGE_KEY } from "./localAiSetup";

describe("AiSetupPanel Cloud setup", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
    window.localStorage.clear();
  });

  it.each([null, "active"] as const)("keeps an unresolved %s plan quiet without purchase or refresh actions", (status) => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { onStartCloudSetup } = renderPanel({
      currentBillingPlan: status === "active" ? "individual" : null,
      billingEntitlementStatus: status,
      billingEntitlementError: "Unable to check billing status.",
      onRefreshCloudStatus: refresh,
    });
    const card = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(card).getByRole("combobox", { name: /^AI model$/i }));
    expect(within(card).queryByRole("button", { name: /Upgrade/i })).toBeNull();
    expect((within(card).getByRole("option", { name: /^Drifty Cloud$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/last confirmed plan is Pro|could not be verified/i)).toBeNull();
    expect(within(card).queryByRole("button", { name: "Refresh plan" })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(onStartCloudSetup).not.toHaveBeenCalled();
  });

  it("does not relabel a retained Enterprise seat as individual Pro", () => {
    renderPanel({ billingEntitlementOwner: "organization", billingEntitlementError: "failed" });
    expect(screen.queryByText(/Your last confirmed plan is Pro/)).toBeNull();
    expect(screen.queryByText(/Your Cloud plan could not be verified/i)).toBeNull();
  });

  it("keeps a pending plan check disabled without an Upgrade action", () => {
    renderPanel({ currentBillingPlan: null, billingEntitlementStatus: null, cloudStatusRefreshing: true });
    const card = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(card).getByRole("combobox", { name: /^AI model$/i }));
    expect(within(card).queryByRole("button", { name: /Checking your plan|Refresh plan/i })).toBeNull();
    expect(within(card).getByRole("option", { name: /^Drifty Cloud$/i })).toHaveProperty("disabled", true);
    expect(within(card).queryByRole("button", { name: /Upgrade/i })).toBeNull();
  });

  it.each(["checking", "failed"] as const)("hides a retained trial offer while the plan is %s", async (state) => {
    const onStartCloudTrial = vi.fn().mockResolvedValue(true);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { onStartCloudSetup } = renderPanel({
      currentBillingPlan: "free", billingEntitlementStatus: "locked", cloudTrialAvailable: true,
      billingEntitlementError: state === "failed" ? "Plan check unavailable." : null,
      cloudStatusRefreshing: state === "checking", onStartCloudTrial, onRefreshCloudStatus: refresh,
    });
    expect(screen.queryByText("7-day free trial available")).toBeNull();
    expect(screen.queryByText("Start your trial when you are ready to use Cloud AI.")).toBeNull();
    const card = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(card).getByRole("combobox", { name: /^AI model$/i }));
    expect(within(card).queryByRole("button", { name: /Checking your plan|Refresh plan|Upgrade/i })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(onStartCloudTrial).not.toHaveBeenCalled();
    expect(onStartCloudSetup).not.toHaveBeenCalled();
  });

  it("routes a confirmed device limit to device management", () => {
    const { onManageCloudDevices, onManageCloudBilling, onStartCloudSetup } = renderPanel({
      currentBillingPlan: "individual", billingEntitlementStatus: "locked", billingEntitlementLockedReason: "device_limit_reached",
    });
    const card = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(card).getByRole("combobox", { name: /^AI model$/i }));
    fireEvent.click(within(card).getByRole("button", { name: "Manage devices" }));
    expect(onManageCloudDevices).toHaveBeenCalledOnce();
    expect(onManageCloudBilling).not.toHaveBeenCalled();
    expect(onStartCloudSetup).not.toHaveBeenCalled();
  });

  it("locks the Drifty cloud model behind upgrade for non-subscribers", () => {
    const { onStartCloudSetup } = renderPanel({ currentBillingPlan: "free", billingEntitlementStatus: "locked" });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Cloud$/i });
    if (!(cloudOption instanceof HTMLButtonElement)) throw new Error("Non-subscriber Drifty Cloud option should render as a disabled button.");
    expect(cloudOption.disabled).toBe(true);
    expect(cloudOption.getAttribute("aria-disabled")).toBe("true");
    expect(cloudOption.getAttribute("aria-selected")).toBe("false");
    expect(cloudOption.className).not.toContain("is-selected");
    expect(cloudOption.querySelector(".settings-select-control__icon")).toBeNull();

    fireEvent.click(cloudOption);
    expect(onStartCloudSetup).not.toHaveBeenCalled();

    const upgradeButton = within(modelBeingUsed).getByRole("button", { name: /^Upgrade to Drifty Pro$/i });
    expect(upgradeButton.textContent).toBe("Upgrade");
    fireEvent.click(upgradeButton);

    expect(onStartCloudSetup).toHaveBeenCalledWith();
  });

  it("keeps the Drifty cloud model selectable on the active Drifty cloud plan", () => {
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Cloud$/i });
    if (!(cloudOption instanceof HTMLButtonElement)) throw new Error("Active Drifty Cloud option should render as a button.");

    expect(cloudOption.disabled).toBe(false);
    expect(cloudOption.getAttribute("aria-disabled")).toBe("false");
    expect(within(modelBeingUsed).queryByRole("button", { name: /^Upgrade to Drifty Pro$/i })).toBeNull();
  });

  it("starts Cloud setup from the dropdown Upgrade action without plan cards", () => {
    const { onStartCloudSetup } = renderPanel({ currentBillingPlan: "free" });

    expect(screen.queryByRole("button", { name: /continue on drifty\.so/i })).toBeNull();
    expect(screen.queryByRole("article", { name: /individual plan/i })).toBeNull();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Upgrade to Drifty Pro$/i }));

    expect(onStartCloudSetup).toHaveBeenCalledWith();
  });

  it("opens billing management from the active Cloud dropdown row", () => {
    const { onManageCloudBilling } = renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Manage billing$/i }));

    expect(onManageCloudBilling).toHaveBeenCalledTimes(1);
  });

  it("routes a locked cloud subscription to Manage billing, never a fresh checkout", () => {
    // A subscribed (individual) user whose entitlement is locked — device limit reached,
    // payment required, etc. — must recover via the billing portal, not buy a 2nd plan.
    const { onManageCloudBilling, onStartCloudSetup } = renderPanel({ currentBillingPlan: "individual", billingEntitlementStatus: "locked" });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Cloud$/i });
    if (!(cloudOption instanceof HTMLButtonElement)) throw new Error("Locked cloud option should render as a button.");
    expect(cloudOption.disabled).toBe(true);
    expect(within(modelBeingUsed).queryByRole("button", { name: /^Upgrade to Drifty Pro$/i })).toBeNull();

    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Manage billing$/i }));
    expect(onManageCloudBilling).toHaveBeenCalledTimes(1);
    expect(onStartCloudSetup).not.toHaveBeenCalled();
  });

  it("shows Upgrade on the trialing Cloud row while keeping it selectable", () => {
    // Trialing users can still select the cloud model, but see an Upgrade CTA to
    // convert the trial rather than Manage billing.
    const { onStartCloudSetup } = renderPanel({ billingEntitlementStatus: "trialing" });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Cloud$/i });
    if (!(cloudOption instanceof HTMLButtonElement)) throw new Error("Trialing Drifty Cloud option should render as a button.");
    expect(cloudOption.disabled).toBe(false);
    expect(within(modelBeingUsed).queryByRole("button", { name: /^Manage billing$/i })).toBeNull();

    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Upgrade to Drifty Pro$/i }));
    expect(onStartCloudSetup).toHaveBeenCalledWith();
  });

  it("does not commit Classification Cloud after the panel unmounts", async () => {
    let finishActivation!: (success: boolean) => void;
    const onStartCloudTrial = vi.fn(() => new Promise<boolean>((resolve) => { finishActivation = resolve; }));
    const onLocalAiSetupChange = vi.fn();
    const rendered = renderPanel({ cloudTrialAvailable: true, currentBillingPlan: "free", billingEntitlementStatus: "locked", onStartCloudTrial, onLocalAiSetupChange });

    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));
    expect(onStartCloudTrial).toHaveBeenCalledOnce();
    rendered.unmount();
    await act(async () => finishActivation(true));

    expect(onLocalAiSetupChange).not.toHaveBeenCalled();
  });

  it("does not commit Intelligence Cloud after the panel unmounts", async () => {
    let finishActivation!: (success: boolean) => void;
    const onStartCloudTrial = vi.fn(() => new Promise<boolean>((resolve) => { finishActivation = resolve; }));
    const onAnalysisChange = vi.fn();
    const rendered = renderPanel({ cloudTrialAvailable: true, currentBillingPlan: "free", billingEntitlementStatus: "locked", onStartCloudTrial, onAnalysisChange });

    fireEvent.click(screen.getByRole("tab", { name: "Intelligence" }));
    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));
    expect(onStartCloudTrial).toHaveBeenCalledOnce();
    rendered.unmount();
    await act(async () => finishActivation(true));

    expect(onAnalysisChange).not.toHaveBeenCalled();
  });

  it("reports Classification persistence failure and retries the durable Cloud transition", async () => {
    const onStartCloudTrial = vi.fn().mockResolvedValue(true);
    const onLocalAiSetupChange = vi.fn();
    let storageAvailable = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === LOCAL_AI_SETUP_STORAGE_KEY && !storageAvailable) {
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      }
      return originalSetItem.call(window.localStorage, key, value);
    });
    renderPanel({
      cloudTrialAvailable: true,
      currentBillingPlan: "free",
      billingEntitlementStatus: "locked",
      initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "openrouter_byok" },
      onStartCloudTrial,
      onLocalAiSetupChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));
    await screen.findByRole("alert");
    expect(onStartCloudTrial).not.toHaveBeenCalled();
    expect(onLocalAiSetupChange).not.toHaveBeenCalled();
    storageAvailable = true;
    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));
    await waitFor(() => expect(onLocalAiSetupChange).toHaveBeenCalledOnce());

    expect(onStartCloudTrial).toHaveBeenCalledOnce();
    expect(JSON.parse(window.localStorage.getItem(LOCAL_AI_SETUP_STORAGE_KEY) ?? "{}")).toMatchObject({ provider: "managed_local", driftyRoute: "cloud" });
  });

  it("reports Intelligence persistence failure without committing Cloud in memory", async () => {
    const onStartCloudTrial = vi.fn().mockResolvedValue(true);
    const onAnalysisChange = vi.fn();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === ANALYSIS_AI_SETUP_STORAGE_KEY) throw new DOMException("Storage unavailable", "QuotaExceededError");
      return originalSetItem.call(window.localStorage, key, value);
    });
    renderPanel({
      cloudTrialAvailable: true,
      currentBillingPlan: "free",
      billingEntitlementStatus: "locked",
      onStartCloudTrial,
      onAnalysisChange,
      initialAnalysisSetup: { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openrouter" },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Intelligence" }));
    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));

    await screen.findByRole("alert");
    expect(onStartCloudTrial).not.toHaveBeenCalled();
    expect(onAnalysisChange).not.toHaveBeenCalled();
  });
});

const originalSetItem = Storage.prototype.setItem;
