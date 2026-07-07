// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_POPOVER_EXPANDED_GAP_PX, AccountMenu } from "./AccountMenu";

type RenderAccountMenuOptions = {
  readonly userAvatarUrl?: string | null;
  readonly userEmail?: string | null;
};

function renderAccountMenu({ userAvatarUrl = null, userEmail = null }: RenderAccountMenuOptions = {}) {
  const handlers = {
    onProfile: vi.fn(),
    onAiSetting: vi.fn(),
    onSettings: vi.fn(),
    onToggleTheme: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onFeedback: vi.fn(),
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
  };

  function Harness() {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <AccountMenu
        isOpen={isOpen}
        isSidebarCollapsed={false}
        userAvatarUrl={userAvatarUrl}
        userEmail={userEmail}
        isDarkMode={false}
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

  it("renders signed-out users with the branded fallback label and the default profile avatar", () => {
    const { container } = renderAccountMenu();
    const trigger = screen.getByRole("button", { name: /^unknown$/i });
    const chevrons = container.querySelector(".account-trigger__chevrons");
    const chevronMarks = container.querySelectorAll(".account-trigger__chevron-mark");

    expect(trigger.querySelector(".account-trigger__copy strong")?.textContent).toBe("ㅕnknown");
    expect(trigger.querySelector(".account-avatar--placeholder svg")).toBeTruthy();
    expect(trigger.querySelector(".account-avatar img")).toBeNull();
    expect(trigger.querySelector(".account-trigger__settings-icon")).toBeNull();
    expect(trigger.querySelector(".account-trigger__status")).toBeNull();

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(chevrons?.getAttribute("aria-hidden")).toBe("true");
    expect(chevronMarks).toHaveLength(2);

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".account-trigger__chevron-mark")).toHaveLength(2);
    expect(screen.getByRole("menu", { name: /account menu/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^AI Setting$/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Settings$/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Drifty Cloud$/ })).toBeNull();
  });

  it("ignores profile artwork while signed out", () => {
    const { container } = renderAccountMenu({ userAvatarUrl: "https://example.test/avatar.png" });
    const trigger = screen.getByRole("button", { name: /^unknown$/i });

    expect(trigger.querySelector(".account-avatar--placeholder svg")).toBeTruthy();
    expect(container.querySelector(".account-trigger__settings-icon")).toBeNull();
    expect(container.querySelector(".account-avatar img")).toBeNull();
  });

  it("keeps account metadata above the first menu separator", () => {
    renderAccountMenu({ userEmail: "pat.lee93@example.com" });
    fireEvent.click(screen.getByRole("button", { name: /^pat\.lee93$/i }));

    const menu = screen.getByRole("menu", { name: /account menu/i });
    const firstChildren = Array.from(menu.children).slice(0, 2);

    expect(firstChildren[0]?.classList.contains("account-popover__account")).toBe(true);
    expect(firstChildren[0]?.textContent).toContain("pat.lee93");
    expect(firstChildren[0]?.textContent).toContain("pat.lee93@example.com");
    expect(firstChildren[1]?.classList.contains("account-menu-separator")).toBe(true);
    expect(firstChildren[1]?.getAttribute("role")).toBe("separator");
  });

  it("lists settings above AI setting", () => {
    const { handlers } = renderAccountMenu();
    fireEvent.click(screen.getByRole("button", { name: /^unknown$/i }));
    const menuItems = screen.getAllByRole("menuitem").map((item) => item.textContent);

    expect(menuItems.slice(0, 2)).toEqual(["Settings", "AI Setting"]);
    fireEvent.click(screen.getByRole("menuitem", { name: /^AI Setting$/ }));
    expect(handlers.onAiSetting).toHaveBeenCalledTimes(1);
  });

  it("toggles theme from the account menu", () => {
    const { handlers } = renderAccountMenu();
    fireEvent.click(screen.getByRole("button", { name: /^unknown$/i }));

    const themeToggle = screen.getByRole("menuitemcheckbox", { name: /dark mode/i });
    expect(themeToggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(themeToggle);
    expect(handlers.onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("routes account settings", () => {
    const { handlers } = renderAccountMenu();
    fireEvent.click(screen.getByRole("button", { name: /^unknown$/i }));

    fireEvent.click(screen.getByRole("menuitem", { name: /^Settings$/ }));
    expect(handlers.onSettings).toHaveBeenCalledTimes(1);
  });
});
