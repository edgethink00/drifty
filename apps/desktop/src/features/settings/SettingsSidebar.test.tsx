// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSidebar, type SettingsSection } from "./SettingsSidebar";

describe("SettingsSidebar", () => {
  afterEach(cleanup);

  it("hides the Dev section when the caller disables it", () => {
    const onSectionChange = vi.fn<(section: SettingsSection) => void>();

    render(<SettingsSidebar activeSection="general" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={onSectionChange} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    expect(within(settingsNav).queryByRole("button", { name: /^Dev$/ })).toBeNull();
    expect(within(settingsNav).getByRole("button", { name: /^Agents & CLI$/ })).toBeTruthy();
    expect(within(settingsNav).getByRole("button", { name: /^Permissions$/ })).toBeTruthy();
    expect(within(settingsNav).getByRole("button", { name: /^Companion & Alerts$/ })).toBeTruthy();
  });

  it("groups sections, marks the current page, and labels the exit action", () => {
    const onBack = vi.fn();

    render(<SettingsSidebar activeSection="permissions" isCollapsed={false} showDevSection={false} onBack={onBack} onSectionChange={vi.fn()} />);

    const aiGroup = screen.getByRole("group", { name: /^AI$/ });
    const personalGroup = screen.getByRole("group", { name: /^Personal$/ });
    expect(within(personalGroup).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "General",
      "Permissions",
      "Appearance",
      "Companion & Alerts",
      "Account",
      "Privacy & Data",
    ]);
    expect(within(aiGroup).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "AI setup",
      "Classification rules",
    ]);
    const advancedGroup = screen.getByRole("group", { name: /^Advanced$/ });
    expect(within(advancedGroup).getAllByRole("button").map((button) => button.textContent)).toEqual(["Agents & CLI"]);
    expect(screen.getAllByRole("group").map((group) => group.getAttribute("aria-labelledby"))).toEqual([
      "settings-nav-group-personal",
      "settings-nav-group-ai",
      "settings-nav-group-advanced",
    ]);
    expect(within(personalGroup).getByText(/^Personal$/).className).toBe("nav-label");
    expect(within(aiGroup).getByText(/^AI$/).className).toBe("nav-label");
    expect(within(advancedGroup).getByText(/^Advanced$/).className).toBe("nav-label");
    expect(screen.getByRole("button", { name: /^Permissions$/ }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("routes to Dev when dev gates enable it", () => {
    const onSectionChange = vi.fn<(section: SettingsSection) => void>();

    render(<SettingsSidebar activeSection="general" isCollapsed={false} showDevSection={true} onBack={vi.fn()} onSectionChange={onSectionChange} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    const settingsButtons = within(settingsNav).getAllByRole("button");
    expect(settingsButtons[settingsButtons.length - 1]?.textContent).toBe("Dev");

    fireEvent.click(screen.getByRole("button", { name: /^Dev$/ }));

    expect(onSectionChange).toHaveBeenCalledWith("dev");
  });

  it("routes to the public Agents & CLI section without dev gates", () => {
    const onSectionChange = vi.fn<(section: SettingsSection) => void>();

    render(<SettingsSidebar activeSection="general" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={onSectionChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^Agents & CLI$/ }));

    expect(onSectionChange).toHaveBeenCalledWith("developer");
  });

  it("keeps collapsed settings nav items labeled for hover without changing accessible names", () => {
    render(<SettingsSidebar activeSection="general" isCollapsed={true} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    const generalButton = within(settingsNav).getByRole("button", { name: /^General$/ });
    const hoverLabel = generalButton.querySelector(".nav-item__hover-label");

    expect(hoverLabel?.textContent).toBe("General");
    expect(hoverLabel?.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives every settings nav item a dedicated icon slot and label", () => {
    render(<SettingsSidebar activeSection="appearance" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    const navItems = within(settingsNav).getAllByRole("button");

    expect(navItems.length).toBeGreaterThan(0);
    for (const item of navItems) {
      expect(item.querySelector(".settings-nav-item__icon")).toBeTruthy();
      expect(item.querySelector(".settings-nav-item__label")).toBeTruthy();
    }
  });

  it("uses the Lucide palette glyph for Appearance", () => {
    render(<SettingsSidebar activeSection="appearance" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    const appearanceButton = within(settingsNav).getByRole("button", { name: /^Appearance$/ });
    const appearanceIcon = appearanceButton.querySelector(".settings-nav-item__icon svg");

    expect(appearanceIcon?.innerHTML).toContain('d="M12 22a1 1 0 0 1 0-20');
    expect(appearanceIcon?.innerHTML).not.toContain("M12 3.5a8.5 8.5 0 0 1 0 17z");
  });
});
