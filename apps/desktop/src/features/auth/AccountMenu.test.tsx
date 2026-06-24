// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCAL_AI_SETUP } from "../settings/localAiSetup";
import { ACCOUNT_POPOVER_EXPANDED_GAP_PX, AccountMenu } from "./AccountMenu";
import type { AuthConnectionStatus } from "./authConnectionStatus";

function renderAccountMenu({
  cloudConnectionStatus = "online",
}: {
  cloudConnectionStatus?: AuthConnectionStatus;
} = {}) {
  const handlers = {
    onUpgrade: vi.fn(),
    onSettings: vi.fn(),
    onFeedback: vi.fn(),
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
  };

  function Harness() {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <AccountMenu
        billingEntitlement={null}
        billingEntitlementLoading={false}
        cloudConnectionStatus={cloudConnectionStatus}
        isOpen={isOpen}
        isSidebarCollapsed={false}
        localAiSetup={DEFAULT_LOCAL_AI_SETUP}
        userAvatarUrl={null}
        userEmail={null}
        onToggle={() => setIsOpen((open) => !open)}
        {...handlers}
      />
    );
  }

  return {
    ...render(<Harness />),
    handlers,
  };
}

describe("AccountMenu", () => {
  it("keeps the expanded account popover close to the trigger", () => {
    expect(ACCOUNT_POPOVER_EXPANDED_GAP_PX).toBe(5);
  });

  it("keeps the account trigger chevrons fixed while aria-expanded changes", () => {
    const { container } = renderAccountMenu();
    const trigger = screen.getByRole("button", { name: /account ai not connected/i });
    const chevrons = container.querySelector(".account-trigger__chevrons");
    const chevronMarks = container.querySelectorAll(".account-trigger__chevron-mark");

    expect(trigger.querySelector(".account-trigger__copy strong")?.textContent).toBe("Account");

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(chevrons?.getAttribute("aria-hidden")).toBe("true");
    expect(chevronMarks).toHaveLength(2);

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".account-trigger__chevron-mark")).toHaveLength(2);
    expect(screen.getByLabelText(/^Drifty Version /).textContent).toMatch(/^Version\d+\.\d+\.\d+$/);
    expect(screen.getByRole("menuitem", { name: /^AI Setting$/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Settings$/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Drifty Cloud$/ })).toBeNull();
  });

  it("routes the account menu app and AI setting actions separately", () => {
    const { handlers } = renderAccountMenu();
    fireEvent.click(screen.getByRole("button", { name: /account ai not connected/i }));

    fireEvent.click(screen.getByRole("menuitem", { name: /^AI Setting$/ }));
    expect(handlers.onUpgrade).toHaveBeenCalledTimes(1);
    expect(handlers.onSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: /^Settings$/ }));
    expect(handlers.onSettings).toHaveBeenCalledTimes(1);
  });

  it("shows offline mode in the account trigger when cloud auth is unavailable", () => {
    renderAccountMenu({ cloudConnectionStatus: "offline" });

    const trigger = screen.getByRole("button", { name: /account offline mode/i });

    expect(trigger.querySelector(".account-trigger__status")?.textContent).toBe("Offline mode");
    expect(trigger.getAttribute("data-cloud-status")).toBe("offline");
  });
});
