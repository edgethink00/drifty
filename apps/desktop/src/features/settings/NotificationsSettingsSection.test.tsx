// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDefaultDriftAlarmCopy } from "../companion/driftAlarmCopy";
import { NotificationsSettingsSection } from "./NotificationsSettingsSection";
import { LocalizationTestProvider, type DisplayLanguage } from "../localization/LocalizationContext";

function renderSettings(
  overrides: Partial<Parameters<typeof NotificationsSettingsSection>[0]> = {},
  language: DisplayLanguage = "en",
) {
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
  render(
    <LocalizationTestProvider language={language}>
      <NotificationsSettingsSection {...props} />
    </LocalizationTestProvider>,
  );
  return props;
}

describe("NotificationsSettingsSection", () => {
  afterEach(cleanup);

  it("shows the menu-bar Companion controls without a placement selector", () => {
    const props = renderSettings();

    expect(screen.queryByRole("radiogroup", { name: "Companion placement" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Menu bar display" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide for 1 hour" }));
    fireEvent.click(screen.getByRole("button", { name: "Off" }));

    expect(props.onHideCompanionForOneHour).toHaveBeenCalledTimes(1);
    expect(props.onCompanionSurfacePolicyChange).toHaveBeenCalledWith("off");
  });

  it("offers an immediate recovery action while temporarily hidden", () => {
    const props = renderSettings({ companionHiddenUntil: Date.now() + 60 * 60 * 1000 });

    expect(screen.getByText(/Hidden until .* Alerts continue normally\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show now" }));

    expect(props.onShowCompanionNow).toHaveBeenCalledTimes(1);
  });

  it("offers a menu-bar recovery action while Companion is permanently off", () => {
    const props = renderSettings({ companionSurfacePolicy: "off" });
    expect(screen.queryByRole("button", { name: "Hide for 1 hour" })).toBeNull();
    expect(screen.getByText("Companion is off")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show in menu bar" }));
    expect(props.onCompanionSurfacePolicyChange).toHaveBeenCalledWith("menuBar");
  });

  it("changes the production menu-bar display", () => {
    const props = renderSettings();
    fireEvent.click(screen.getByRole("radio", { name: "Donut + focus time" }));

    expect(props.onCompanionMenuBarDisplayModeChange).toHaveBeenCalledWith("donutFocusTime");
  });


  it("shows a persistent Beta status label on Extreme nudge", () => {
    renderSettings();
    const beta = screen.getByText("Beta");
    expect(beta.className).toContain("status-badge--beta");
    expect(beta.getAttribute("aria-hidden")).toBeNull();
  });

  it("localizes the production pet settings in Korean", () => {
    renderSettings({ showPetNewBadge: true }, "ko");

    expect(screen.getByRole("heading", { name: "데스크톱 펫" })).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.queryByText("신규")).toBeNull();
    expect(screen.queryByText("베타")).toBeNull();
    expect(screen.getByText("펫 표시")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "펫 크기" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "아이보리" })).toBeTruthy();
  });
});
