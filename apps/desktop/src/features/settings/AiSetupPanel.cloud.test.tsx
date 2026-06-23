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

  it("shows a subscription action on the Drifty cloud model option for non-subscribers", () => {
    const { onStartCloudSetup } = renderPanel({ currentBillingPlan: "free" });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Individual \(Cloud\)$/i });
    expect(cloudOption.querySelector(".settings-select-control__icon")).toBeNull();

    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Subscribe to Drifty Individual Cloud$/i }));

    expect(onStartCloudSetup).toHaveBeenCalledWith();
  });

  it("does not show a subscription action on the active Drifty cloud plan", () => {
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));

    expect(within(modelBeingUsed).queryByRole("button", { name: /^Subscribe to Drifty Individual Cloud$/i })).toBeNull();
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
});
