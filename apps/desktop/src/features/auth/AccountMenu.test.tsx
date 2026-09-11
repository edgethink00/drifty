// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_POPOVER_COLLAPSED_GAP_PX,
  ACCOUNT_POPOVER_EXPANDED_GAP_PX,
  AccountMenu,
  collapsedAccountPopoverLeftPx,
} from "./AccountMenu";
import {
  LocalizationProvider,
  LocalizationTestProvider,
  useLocalizationController,
  type DisplayLanguage,
} from "../localization/LocalizationContext";
import { DISPLAY_LANGUAGE_STORAGE_KEY } from "../localization/languagePreference";

type RenderAccountMenuOptions = {
  readonly userAvatarUrl?: string | null;
  readonly userEmail?: string | null;
  readonly language?: DisplayLanguage;
};

function renderAccountMenu({ userAvatarUrl = null, userEmail = null, language = "en" }: RenderAccountMenuOptions = {}) {
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
      <LocalizationTestProvider language={language}>
        <AccountMenu
          isOpen={isOpen}
          isSidebarCollapsed={false}
          userAvatarUrl={userAvatarUrl}
          userEmail={userEmail}
          isDarkMode={false}
          isPetVisible={false}
          onTogglePet={() => {}}
          onToggle={() => setIsOpen((open) => !open)}
          {...handlers}
        />
      </LocalizationTestProvider>
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

  it("anchors the collapsed popover to the visible rail, not the unclipped trigger", () => {
    expect(ACCOUNT_POPOVER_COLLAPSED_GAP_PX).toBe(10);
    expect(collapsedAccountPopoverLeftPx(54)).toBe(64);
    expect(collapsedAccountPopoverLeftPx(54)).not.toBe(211.5 + ACCOUNT_POPOVER_COLLAPSED_GAP_PX);

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
        <LocalizationTestProvider language="en">
          <div className="sidebar sidebar--collapsed">
            <AccountMenu
              isOpen={isOpen}
              isSidebarCollapsed
              userAvatarUrl={null}
              userEmail={null}
              isDarkMode={false}
              isPetVisible={false}
              onTogglePet={() => {}}
              onToggle={() => setIsOpen((open) => !open)}
              {...handlers}
            />
          </div>
        </LocalizationTestProvider>
      );
    }

    const { container } = render(<Harness />);
    const sidebar = container.querySelector(".sidebar") as HTMLElement;
    const trigger = screen.getByRole("button", { name: /^unknown$/i });
    vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 54,
      height: 820,
      top: 0,
      right: 54,
      bottom: 820,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 6.5,
      y: 769,
      width: 205,
      height: 43,
      top: 769,
      right: 211.5,
      bottom: 812,
      left: 6.5,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: /account menu/i });
    expect(menu.style.left).toBe("64px");
  });

  it("renders signed-out users with the branded fallback label and the default profile avatar", () => {
    const { container } = renderAccountMenu();
    const trigger = screen.getByRole("button", { name: /^unknown$/i });
    const chevrons = container.querySelector(".account-trigger__chevrons");
    const chevronMarks = container.querySelectorAll(".account-trigger__chevron-mark");

    expect(trigger.querySelector(".account-trigger__copy strong")?.textContent).toBe("Unknown");
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
    expect(screen.getByRole("menuitem", { name: /^AI settings$/ })).toBeTruthy();
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

  it("groups language with quick preferences below settings destinations", () => {
    const { handlers } = renderAccountMenu();
    fireEvent.click(screen.getByRole("button", { name: /^unknown$/i }));
    const menuItems = screen.getAllByRole("menuitem").map((item) => item.textContent);

    expect(menuItems.slice(0, 3)).toEqual(["Settings", "AI settings", "LanguageEnglish"]);
    fireEvent.click(screen.getByRole("menuitem", { name: /^AI settings$/ }));
    expect(handlers.onAiSetting).toHaveBeenCalledTimes(1);
  });

  it("opens a keyboard-friendly language submenu and switches the display language", async () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");

    function LanguageHarness() {
      const controller = useLocalizationController();
      const [isOpen, setIsOpen] = useState(false);
      return (
        <LocalizationProvider controller={controller}>
          <AccountMenu
            isOpen={isOpen}
            isSidebarCollapsed={false}
            userAvatarUrl={null}
            userEmail={null}
            isDarkMode={false}
            isPetVisible={false}
            onToggle={() => setIsOpen((open) => !open)}
            onProfile={() => {}}
            onAiSetting={() => {}}
            onSettings={() => {}}
            onToggleTheme={() => {}}
            onTogglePet={() => {}}
            onCheckForUpdates={() => {}}
            onFeedback={() => {}}
            onSignIn={() => {}}
            onSignOut={() => {}}
          />
        </LocalizationProvider>
      );
    }

    render(<LanguageHarness />);
    fireEvent.click(screen.getByRole("button", { name: /^unknown$/i }));
    const languageItem = screen.getByRole("menuitem", { name: /^Language English$/ });
    fireEvent.keyDown(languageItem, { key: "ArrowRight" });

    const englishOption = screen.getByRole("menuitemradio", { name: "English" });
    const koreanOption = screen.getByRole("menuitemradio", { name: "Korean" });
    expect(englishOption.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(englishOption);

    fireEvent.keyDown(englishOption, { key: "ArrowDown" });
    expect(document.activeElement).toBe(koreanOption);
    fireEvent.keyDown(koreanOption, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(languageItem);

    fireEvent.click(languageItem);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Korean" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "게스트" })).toBeTruthy());
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("ko");
    window.localStorage.removeItem(DISPLAY_LANGUAGE_STORAGE_KEY);
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

  it("dismisses with Escape and restores focus to the trigger", () => {
    renderAccountMenu();
    const trigger = screen.getByRole("button", { name: /^unknown$/i });
    fireEvent.click(trigger);

    const settingsItem = screen.getByRole("menuitem", { name: /^Settings$/ });
    settingsItem.focus();
    expect(document.activeElement).toBe(settingsItem);

    fireEvent.keyDown(settingsItem, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: /account menu/i })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses on outside pointer input but not interaction inside the menu", () => {
    renderAccountMenu();
    fireEvent.click(screen.getByRole("button", { name: /^unknown$/i }));

    const settingsItem = screen.getByRole("menuitem", { name: /^Settings$/ });
    fireEvent.pointerDown(settingsItem);
    expect(screen.getByRole("menu", { name: /account menu/i })).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: /account menu/i })).toBeNull();
  });

  it("localizes the signed-out account menu in Korean", () => {
    renderAccountMenu({ language: "ko" });
    fireEvent.click(screen.getByRole("button", { name: "게스트" }));

    expect(screen.getByRole("menu", { name: "계정 메뉴" })).toBeTruthy();
    expect(screen.getByText("로그인하지 않음")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "설정" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "언어 한국어" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "AI 설정" })).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: "다크 모드" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "로그인" })).toBeTruthy();
  });
});
