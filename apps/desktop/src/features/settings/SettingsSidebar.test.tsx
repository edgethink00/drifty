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
    expect(within(settingsNav).getByRole("button", { name: /^Permissions$/ })).toBeTruthy();
    expect(within(settingsNav).getByRole("button", { name: /^Notifications$/ })).toBeTruthy();
  });

  it("groups sections, marks the current page, and labels the exit action", () => {
    const onBack = vi.fn();

    render(<SettingsSidebar activeSection="permissions" isCollapsed={false} showDevSection={false} onBack={onBack} onSectionChange={vi.fn()} />);

    const appGroup = screen.getByRole("group", { name: /^App$/ });
    const aiGroup = screen.getByRole("group", { name: /^AI$/ });
    const accountDataGroup = screen.getByRole("group", { name: /^Account & data$/ });
    expect(within(appGroup).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "General",
      "Permissions",
      "Appearance",
      "Notifications",
    ]);
    expect(within(aiGroup).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "AI setup",
      "Classification rules",
    ]);
    expect(within(accountDataGroup).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Account",
      "Privacy & Data",
    ]);
    expect(screen.getAllByRole("group").map((group) => group.getAttribute("aria-label"))).toEqual(["App", "Account & data", "AI"]);
    expect(screen.getByRole("button", { name: /^Permissions$/ }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("routes to Dev when dev gates enable it", () => {
    const onSectionChange = vi.fn<(section: SettingsSection) => void>();

    render(<SettingsSidebar activeSection="general" isCollapsed={false} showDevSection={true} onBack={vi.fn()} onSectionChange={onSectionChange} />);

    fireEvent.click(screen.getByRole("button", { name: /^Dev$/ }));

    expect(onSectionChange).toHaveBeenCalledWith("dev");
  });

  it("keeps collapsed settings nav items labeled for hover without changing accessible names", () => {
    render(<SettingsSidebar activeSection="general" isCollapsed={true} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    const generalButton = within(settingsNav).getByRole("button", { name: /^General$/ });
    const hoverLabel = generalButton.querySelector(".nav-item__hover-label");

    expect(hoverLabel?.textContent).toBe("General");
    expect(hoverLabel?.getAttribute("aria-hidden")).toBe("true");
  });
});
