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
});
