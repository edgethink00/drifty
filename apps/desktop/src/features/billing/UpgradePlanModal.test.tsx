// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpgradePlanModal } from "./UpgradePlanModal";

afterEach(cleanup);

describe("UpgradePlanModal", () => {
  it("keeps the upgrade decision in-app until a billing interval is selected", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Upgrade to Pro";
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const onSelectBillingPlan = vi.fn();

    const { container, unmount } = render(
      <UpgradePlanModal
        billingActionError={null}
        billingCheckoutLoadingInterval={null}
        onClose={onClose}
        onSelectBillingPlan={onSelectBillingPlan}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: /^Upgrade to Pro$/i });
    expect(container.querySelector(".dashboard-ai-recovery__plans")?.getAttribute("aria-busy")).toBe("false");
    expect(within(dialog).getAllByText(/^Drifty Pro$/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("article", { name: /free plan/i }).textContent).toContain("Current plan");
    expect(within(dialog).getByRole("radio", { name: /monthly/i }).getAttribute("aria-checked")).toBe("true");
    expect(onSelectBillingPlan).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: /dismiss plan selection/i })));

    fireEvent.click(within(dialog).getByRole("radio", { name: /yearly/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /choose drifty pro plan/i }));
    expect(onSelectBillingPlan).toHaveBeenCalledWith("yearly");

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("closes with Escape and exposes checkout failures without hiding the plans", () => {
    const onClose = vi.fn();
    render(
      <UpgradePlanModal
        billingActionError="Checkout could not be opened."
        billingCheckoutLoadingInterval={null}
        onClose={onClose}
        onSelectBillingPlan={vi.fn()}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /choose drifty pro plan/i }));
    expect(screen.getByRole("alert").textContent).toContain("Checkout could not be opened");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the dimmed backdrop is clicked, but not when the plan panel is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <UpgradePlanModal
        billingActionError={null}
        billingCheckoutLoadingInterval={null}
        onClose={onClose}
        onSelectBillingPlan={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("dialog", { name: /^Upgrade to Pro$/i }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector(".dashboard-ai-recovery")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed while checkout creation is in flight", () => {
    const onClose = vi.fn();
    const { container } = render(
      <UpgradePlanModal
        billingActionError={null}
        billingCheckoutLoadingInterval="monthly"
        onClose={onClose}
        onSelectBillingPlan={vi.fn()}
      />,
    );

    const closeButton = screen.getByRole("button", { name: /dismiss plan selection/i });
    expect(container.querySelector(".dashboard-ai-recovery__plans")?.getAttribute("aria-busy")).toBe("true");
    expect(closeButton).toHaveProperty("disabled", true);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(closeButton);
    fireEvent.click(container.querySelector(".dashboard-ai-recovery")!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
