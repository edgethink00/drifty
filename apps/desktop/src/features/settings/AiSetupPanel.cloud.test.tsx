// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock } from "./AiSetupPanel.testHarness";

describe("AiSetupPanel Cloud setup", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
  });

  it("locks the Drifty cloud model behind upgrade for non-subscribers", () => {
    const { onStartCloudSetup } = renderPanel({ currentBillingPlan: "free", billingEntitlementStatus: "locked" });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Individual \(Cloud\)$/i });
    if (!(cloudOption instanceof HTMLButtonElement)) throw new Error("Non-subscriber Drifty Cloud option should render as a disabled button.");
    expect(cloudOption.disabled).toBe(true);
    expect(cloudOption.getAttribute("aria-disabled")).toBe("true");
    expect(cloudOption.getAttribute("aria-selected")).toBe("false");
    expect(cloudOption.className).not.toContain("is-selected");
    expect(cloudOption.querySelector(".settings-select-control__icon")).toBeNull();

    fireEvent.click(cloudOption);
    expect(onStartCloudSetup).not.toHaveBeenCalled();

    const upgradeButton = within(modelBeingUsed).getByRole("button", { name: /^Upgrade Drifty Individual Cloud$/i });
    expect(upgradeButton.textContent).toBe("Upgrade");
    fireEvent.click(upgradeButton);

    expect(onStartCloudSetup).toHaveBeenCalledWith();
  });

  it("keeps the Drifty cloud model selectable on the active Drifty cloud plan", () => {
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Individual \(Cloud\)$/i });
    if (!(cloudOption instanceof HTMLButtonElement)) throw new Error("Active Drifty Cloud option should render as a button.");

    expect(cloudOption.disabled).toBe(false);
    expect(cloudOption.getAttribute("aria-disabled")).toBe("false");
    expect(within(modelBeingUsed).queryByRole("button", { name: /^Upgrade Drifty Individual Cloud$/i })).toBeNull();
  });

  it("starts Cloud setup from the Polar CTA without plan cards", () => {
    const { onStartCloudSetup } = renderPanel({ currentBillingPlan: "free" });

    expect(screen.queryByRole("button", { name: /continue on drifty\.so/i })).toBeNull();
    expect(screen.queryByRole("article", { name: /individual plan/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /upgrade to individual/i }));

    expect(onStartCloudSetup).toHaveBeenCalledWith();
  });

  it("opens billing management from the active Cloud row", () => {
    const { onManageCloudBilling, onRefreshCloudStatus } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /manage billing/i }));

    expect(onManageCloudBilling).toHaveBeenCalledTimes(1);
    expect(onRefreshCloudStatus).not.toHaveBeenCalled();
  });

  it("opens checkout from the trialing Cloud row", () => {
    const { onRefreshCloudStatus, onStartCloudSetup } = renderPanel({ billingEntitlementStatus: "trialing" });

    fireEvent.click(screen.getByRole("button", { name: /upgrade to individual/i }));

    expect(onStartCloudSetup).toHaveBeenCalledWith();
    expect(onRefreshCloudStatus).not.toHaveBeenCalled();
  });

  it("shows active trial copy in the Cloud row", () => {
    renderPanel({
      billingEntitlementStatus: "trialing",
      cloudTrialEndsAt: "2026-06-20T00:00:00.000Z",
    });

    const cloudSettings = screen.getByRole("group", { name: /Drifty Cloud settings/i });

    expect(within(cloudSettings).getByText(/1-week free trial is active/i)).toBeTruthy();
    expect(within(cloudSettings).getByText(/available until jun 20/i)).toBeTruthy();
  });

  it("shows the signed-in Cloud account with a masked email", () => {
    renderPanel({ userEmail: "alex@example.com" });

    const cloudSettings = screen.getByRole("group", { name: /Drifty Cloud settings/i });

    expect(within(cloudSettings).getByText("al***@example.com")).toBeTruthy();
    expect(within(cloudSettings).queryByText("alex@example.com")).toBeNull();
  });

  it("links device-limit Cloud setup to Account device management", () => {
    const { onManageCloudDevices, onRefreshCloudStatus } = renderPanel({
      billingEntitlementStatus: "locked",
      billingEntitlementLockedReason: "device_limit_reached",
    });

    const cloudSettings = screen.getByRole("group", { name: /Drifty Cloud settings/i });
    expect(within(cloudSettings).getByText(/Manage active Macs in Account settings/i)).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Cloud devices/i })).toBeNull();

    fireEvent.click(within(cloudSettings).getByRole("button", { name: /^Manage devices$/i }));

    expect(onManageCloudDevices).toHaveBeenCalledTimes(1);
    expect(onRefreshCloudStatus).not.toHaveBeenCalled();
  });
});
