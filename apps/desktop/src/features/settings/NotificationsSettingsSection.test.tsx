// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDefaultDriftAlarmCopy } from "../companion/driftAlarmCopy";
import { NotificationsSettingsSection } from "./NotificationsSettingsSection";

function renderSettings(overrides: Partial<Parameters<typeof NotificationsSettingsSection>[0]> = {}) {
  const props = {
    companionHiddenUntil: null,
    companionSurfacePolicy: "menuBar" as const,
    companionMenuBarDisplayMode: "focusTime" as const,
    driftAlertDelaySeconds: 60 as const,
    driftAlertsEnabled: true,
    driftAlarmCopy: buildDefaultDriftAlarmCopy(),
    extremeNudgeEnabled: false,
    onCompanionSurfacePolicyChange: vi.fn(),
    onCompanionMenuBarDisplayModeChange: vi.fn(),
    onDriftAlertDelaySecondsChange: vi.fn(),
    onDriftAlarmCopyChange: vi.fn(),
    onDriftAlertsChange: vi.fn(),
    onExtremeNudgeChange: vi.fn(),
    onHideCompanionForOneHour: vi.fn(),
    onShowCompanionNow: vi.fn(),
    petModeEnabled: false,
    petModeCoat: "ivory" as const,
    petModeSize: 100 as const,
    onPetModeEnabledChange: vi.fn(),
    onPetModeCoatChange: vi.fn(),
    onPetModeSizeChange: vi.fn(),
    ...overrides,
  };
  render(<NotificationsSettingsSection {...props} />);
  return props;
}

describe("NotificationsSettingsSection", () => {
  afterEach(cleanup);

  it("keeps Companion placement and temporary hide distinct", () => {
    const props = renderSettings();

    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide for 1 hour" }));

    expect(props.onCompanionSurfacePolicyChange).toHaveBeenCalledWith("off");
    expect(props.onHideCompanionForOneHour).toHaveBeenCalledTimes(1);
  });

  it("keeps Companion controls out of the legacy settings experience", () => {
    renderSettings({ companionSettingsVisible: false });

    expect(screen.queryByRole("radio", { name: "Off" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Drift alerts" })).toBeTruthy();
  });

  it("offers an immediate recovery action while temporarily hidden", () => {
    const props = renderSettings({ companionHiddenUntil: Date.now() + 60 * 60 * 1000 });

    expect(screen.getByText(/Hidden until .* Alerts continue normally\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show now" }));

    expect(props.onShowCompanionNow).toHaveBeenCalledTimes(1);
  });

  it("disables temporary hide while Companion is permanently off", () => {
    renderSettings({ companionSurfacePolicy: "off" });
    expect(screen.getByRole("button", { name: "Hide for 1 hour" }).getAttribute("disabled")).toBe("");
    expect(screen.getByText(/Hide the resident Companion\. Safety alerts and earned milestones still arrive\./)).toBeTruthy();
  });

  it("keeps menu-bar display choices scoped to the menu-bar Companion", () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole("radio", { name: "Donut + focus time" }));

    expect(props.onCompanionMenuBarDisplayModeChange).toHaveBeenCalledWith("donutFocusTime");

    cleanup();
    renderSettings({ companionSurfacePolicy: "floating" });
    expect(screen.queryByRole("radiogroup", { name: "Menu bar display" })).toBeNull();
  });
});
