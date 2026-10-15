// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsSidebar, type SettingsSection } from "./SettingsSidebar";
import { DRIFTY_DISCORD_INVITE_URL } from "./SettingsSidebar";

const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

describe("SettingsSidebar", () => {
  beforeEach(() => {
    openUrlMock.mockReset();
    openUrlMock.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("hides the Dev section when the caller disables it", () => {
    const onSectionChange = vi.fn<(section: SettingsSection) => void>();

    render(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="general" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={onSectionChange} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    expect(within(settingsNav).queryByRole("button", { name: /^Dev$/ })).toBeNull();
    expect(within(settingsNav).getByRole("button", { name: /^Agents & CLI$/ })).toBeTruthy();
    expect(within(settingsNav).getByRole("button", { name: /^Companion & Alerts$/ })).toBeTruthy();
  });

  it("groups sections, marks the current page, and labels the exit action", () => {
    const onBack = vi.fn();

    render(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="privacy" isCollapsed={false} showDevSection={false} onBack={onBack} onSectionChange={vi.fn()} />);

    const aiGroup = screen.getByRole("group", { name: /^AI$/ });
    const personalGroup = screen.getByRole("group", { name: /^Personal$/ });
    // Permissions live at the end of General, so they no longer take a rail row.
    expect(within(personalGroup).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "General",
      "Desktop pet",
      "Companion & Alerts",
      "Account",
      "Sync",
      "Privacy & Data",
    ]);
    // Categories open as their own editor (General has the door), so they take no rail row.
    expect(within(aiGroup).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Classification",
      "Intelligence",
      "Memory",
    ]);
    const advancedGroup = screen.getByRole("group", { name: /^Advanced$/ });
    expect(within(advancedGroup).getAllByRole("button").map((button) => button.textContent)).toEqual(["Agents & CLI"]);
    expect(
      screen.getAllByRole("group")
        .map((group) => group.getAttribute("aria-labelledby"))
        .filter((id) => id),
    ).toEqual([
      "settings-nav-group-personal",
      "settings-nav-group-ai",
      "settings-nav-group-advanced",
    ]);
    expect(within(personalGroup).getByText(/^Personal$/).className).toBe("nav-label");
    expect(within(aiGroup).getByText(/^AI$/).className).toBe("nav-label");
    expect(within(advancedGroup).getByText(/^Advanced$/).className).toBe("nav-label");
    expect(screen.getByRole("button", { name: /^Privacy & Data$/ }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("opens each AI settings section from its own rail item and hides Intelligence when the feature is off", () => {
    const onSectionChange = vi.fn<(section: SettingsSection) => void>();
    const { rerender } = render(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="intelligence" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={onSectionChange} />);

    const aiGroup = screen.getByRole("group", { name: /^AI$/ });
    expect(within(aiGroup).getByRole("button", { name: /^Intelligence$/ }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(aiGroup).getByRole("button", { name: /^Classification$/ }));
    fireEvent.click(within(aiGroup).getByRole("button", { name: /^Memory$/ }));
    expect(onSectionChange.mock.calls.map(([section]) => section)).toEqual(["aiSetup", "memory"]);

    rerender(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="aiSetup" isCollapsed={false} showDevSection={false} showIntelligenceSection={false} onBack={vi.fn()} onSectionChange={onSectionChange} />);
    expect(within(screen.getByRole("group", { name: /^AI$/ })).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Classification",
      "Memory",
    ]);
  });

  it("marks a section that needs attention without changing its name", () => {
    const { rerender } = render(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="pet" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    const general = screen.getByRole("button", { name: /^General$/ });
    expect(general.querySelector(".settings-nav-item__attention")).toBeNull();
    expect(general.getAttribute("aria-describedby")).toBeNull();

    rerender(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="pet" isCollapsed={false} sectionsNeedingAttention={["general"]} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    const flagged = screen.getByRole("button", { name: /^General$/ });
    expect(flagged.querySelector(".settings-nav-item__attention")).toBeTruthy();
    const descriptionId = flagged.getAttribute("aria-describedby");
    expect(descriptionId ? document.getElementById(descriptionId)?.textContent : null).toBe("A required permission is turned off");
    expect(screen.getByRole("button", { name: /^Desktop pet$/ }).querySelector(".settings-nav-item__attention")).toBeNull();
  });

  it("keeps Discord and feedback as rail exits instead of settings pages", () => {
    const onSendFeedback = vi.fn();
    render(<SettingsSidebar onSendFeedback={onSendFeedback} activeSection="general" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    expect(within(settingsNav).queryByRole("button", { name: /^Community$/ })).toBeNull();
    expect(within(settingsNav).queryByRole("button", { name: /^Send feedback$/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Send feedback$/ }));
    expect(onSendFeedback).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /^Community$/ })).toBeTruthy();
  });

  it("opens the permanent Drifty Discord invite outside the app", async () => {
    render(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="general" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Community$/ }));

    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(DRIFTY_DISCORD_INVITE_URL));
  });

  it("routes to Dev when dev gates enable it", () => {
    const onSectionChange = vi.fn<(section: SettingsSection) => void>();

    render(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="general" isCollapsed={false} showDevSection={true} onBack={vi.fn()} onSectionChange={onSectionChange} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    const settingsButtons = within(settingsNav).getAllByRole("button");
    expect(settingsButtons[settingsButtons.length - 1]?.textContent).toBe("Dev");

    fireEvent.click(screen.getByRole("button", { name: /^Dev$/ }));

    expect(onSectionChange).toHaveBeenCalledWith("dev");
  });

  it("keeps Dev as one settings item without nested sidebar navigation", () => {
    render(
      <SettingsSidebar
        activeSection="dev"
        activeDevSubsection="diagnostics"
        isCollapsed={false}
        showDevSection
        onBack={vi.fn()}
        onDevSubsectionChange={vi.fn()}
        onSectionChange={vi.fn()}
        onSendFeedback={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /^Dev$/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("navigation", { name: "Dev sections" })).toBeNull();
  });

  it("routes to the public Agents & CLI section without dev gates", () => {
    const onSectionChange = vi.fn<(section: SettingsSection) => void>();

    render(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="general" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={onSectionChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^Agents & CLI$/ }));

    expect(onSectionChange).toHaveBeenCalledWith("developer");
  });

  it("keeps collapsed settings nav items labeled for hover without changing accessible names", () => {
    render(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="general" isCollapsed={true} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    const generalButton = within(settingsNav).getByRole("button", { name: /^General$/ });
    const hoverLabel = generalButton.querySelector(".nav-item__hover-label");

    expect(hoverLabel?.textContent).toBe("General");
    expect(hoverLabel?.getAttribute("aria-hidden")).toBe("true");
  });

  it("marks Dev as the current page when its subnavigation is hidden by the collapsed rail", () => {
    render(
      <SettingsSidebar
        activeSection="dev"
        activeDevSubsection="diagnostics"
        isCollapsed
        showDevSection
        onBack={vi.fn()}
        onSectionChange={vi.fn()}
        onSendFeedback={vi.fn()}
      />,
    );

    const devButton = screen.getByRole("button", { name: /^Dev$/ });
    expect(devButton.getAttribute("aria-current")).toBe("page");
    expect(devButton.hasAttribute("aria-controls")).toBe(false);
    expect(devButton.hasAttribute("aria-expanded")).toBe(false);
    expect(screen.queryByRole("group", { name: "Dev sections" })).toBeNull();
  });

  it("gives every settings nav item a dedicated icon slot and label", () => {
    render(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="pet" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    const navItems = within(settingsNav).getAllByRole("button");

    expect(navItems.length).toBeGreaterThan(0);
    for (const item of navItems) {
      expect(item.querySelector(".settings-nav-item__icon")).toBeTruthy();
      expect(item.querySelector(".settings-nav-item__label")).toBeTruthy();
    }
  });

  it("folds Appearance into General instead of keeping its own page", () => {
    render(<SettingsSidebar onSendFeedback={vi.fn()} activeSection="general" isCollapsed={false} showDevSection={false} onBack={vi.fn()} onSectionChange={vi.fn()} />);

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    expect(within(settingsNav).queryByRole("button", { name: /^Appearance$/ })).toBeNull();
  });
});
