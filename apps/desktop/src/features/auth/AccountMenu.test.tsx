// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCAL_AI_SETUP } from "../settings/localAiSetup";
import { AccountMenu } from "./AccountMenu";

function renderAccountMenu() {
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
  it("keeps the account trigger chevrons fixed while aria-expanded changes", () => {
    const { container } = renderAccountMenu();
    const trigger = screen.getByRole("button", { name: /account ai not connected/i });
    const chevrons = container.querySelector(".account-trigger__chevrons");
    const chevronMarks = container.querySelectorAll(".account-trigger__chevron-mark");

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(chevrons?.getAttribute("aria-hidden")).toBe("true");
    expect(chevronMarks).toHaveLength(2);

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".account-trigger__chevron-mark")).toHaveLength(2);
  });
});
