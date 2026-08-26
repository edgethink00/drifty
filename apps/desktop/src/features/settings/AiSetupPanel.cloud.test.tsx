// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock } from "./AiSetupPanel.testHarness";

describe("AiSetupPanel Cloud setup", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
  });

  it("locks the Drifty cloud model behind upgrade for non-subscribers", () => {
    const { onStartCloudSetup } = renderPanel({ currentBillingPlan: "free", billingEntitlementStatus: "locked" });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Pro \(Cloud\)$/i });
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
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Pro \(Cloud\)$/i });
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
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Pro \(Cloud\)$/i });
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
    const cloudOption = within(modelBeingUsed).getByRole("option", { name: /^Drifty Pro \(Cloud\)$/i });
    if (!(cloudOption instanceof HTMLButtonElement)) throw new Error("Trialing Drifty Cloud option should render as a button.");
    expect(cloudOption.disabled).toBe(false);
    expect(within(modelBeingUsed).queryByRole("button", { name: /^Manage billing$/i })).toBeNull();

    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Upgrade to Drifty Pro$/i }));
    expect(onStartCloudSetup).toHaveBeenCalledWith();
  });
});
