// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsSidebar, type SettingsSection } from "./SettingsSidebar";

describe("SettingsSidebar", () => {
  it("hides the Dev section when the caller disables it", () => {
    const onSectionChange = vi.fn<(section: SettingsSection) => void>();

    render(<SettingsSidebar activeSection="general" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={onSectionChange} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    expect(within(settingsNav).queryByRole("button", { name: /^Dev$/ })).toBeNull();
    expect(within(settingsNav).getByRole("button", { name: /^Notifications$/ })).toBeTruthy();
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
