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
    driftAlertDelaySeconds: 60 as const,
    driftAlertsEnabled: true,
    driftAlarmCopy: buildDefaultDriftAlarmCopy(),
    extremeNudgeEnabled: false,
    onCompanionSurfacePolicyChange: vi.fn(),
    onDriftAlertDelaySecondsChange: vi.fn(),
    onDriftAlarmCopyChange: vi.fn(),
    onDriftAlertsChange: vi.fn(),
    onExtremeNudgeChange: vi.fn(),
    onHideCompanionForOneHour: vi.fn(),
    onShowCompanionNow: vi.fn(),
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

  it("combines Companion visibility into one row with two direct actions", () => {
    const props = renderSettings();

    expect(screen.queryByRole("radiogroup", { name: "Companion placement" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Menu bar display" })).toBeNull();
    const visibilityActions = screen.getByRole("group", { name: "Companion visibility" });
    expect(visibilityActions.querySelectorAll("button")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Hide for 1 hour" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

    expect(props.onHideCompanionForOneHour).toHaveBeenCalledTimes(1);
    expect(props.onCompanionSurfacePolicyChange).toHaveBeenCalledWith("off");
  });

  it("offers an immediate recovery action while temporarily hidden", () => {
    const props = renderSettings({ companionHiddenUntil: Date.now() + 60 * 60 * 1000 });

    expect(screen.getByText(/Hidden until .* Alerts and celebrations continue\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show now" }));

    expect(props.onShowCompanionNow).toHaveBeenCalledTimes(1);
  });

  it("offers a menu-bar recovery action while Companion is permanently off", () => {
    const props = renderSettings({ companionSurfacePolicy: "off" });
    expect(screen.getByText("Off. Alerts and celebrations continue.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide for 1 hour" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(props.onCompanionSurfacePolicyChange).toHaveBeenCalledWith("menuBar");
  });

  it("does not offer a temporary hide while Companion is off", () => {
    const props = renderSettings({ companionSurfacePolicy: "off" });
    const hideButton = screen.getByRole("button", { name: "Hide for 1 hour" });

    expect(hideButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(hideButton);
    expect(props.onCompanionSurfacePolicyChange).not.toHaveBeenCalled();
    expect(props.onHideCompanionForOneHour).not.toHaveBeenCalled();
  });


  it("shows a persistent Beta status label on Automatic close", () => {
    renderSettings();
    const badges = screen.getAllByText("Beta");
    expect(badges).toHaveLength(1);
    expect(badges.every((badge) => badge.className.includes("status-badge--beta"))).toBe(true);
    expect(badges.every((badge) => badge.getAttribute("aria-hidden") === null)).toBe(true);
  });

  it("keeps pet appearance out of alerts and exposes one automatic-close control", () => {
    const props = renderSettings({ driftAlertsEnabled: false, extremeNudgeEnabled: false });
    expect(screen.queryByRole("heading", { name: "Desktop pet" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Pet coat" })).toBeNull();
    const toggles = screen.getAllByRole("switch", { name: /automatic close/i });
    expect(toggles).toHaveLength(1);
    fireEvent.click(toggles[0]!);
    expect(props.onDriftAlertsChange).toHaveBeenCalledWith(true);
    expect(props.onExtremeNudgeChange).toHaveBeenCalledWith(true);
  });

  it("turns Automatic close off silently when Drift alerts are turned off", () => {
    const props = renderSettings({ driftAlertsEnabled: true, extremeNudgeEnabled: true });

    fireEvent.click(screen.getByRole("switch", { name: /toggle drift alerts/i }));

    expect(props.onDriftAlertsChange).toHaveBeenCalledWith(false);
    expect(props.onExtremeNudgeChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("explains automatic close independently of pet visibility in Korean", () => {
    renderSettings({ driftAlertsEnabled: true, extremeNudgeEnabled: true }, "ko");
    expect(screen.getByText("펫이 꺼져 있어도 지원되는 딴짓 탭과 앱을 닫습니다. 커뮤니케이션 활동은 닫지 않습니다.")).toBeTruthy();
    expect(screen.getAllByRole("switch", { name: /자동 닫기/ })).toHaveLength(1);
  });

  it("connects each Automatic close switch to its row copy", () => {
    renderSettings({ driftAlertsEnabled: true, extremeNudgeEnabled: false });

    const toggles = screen.getAllByRole("switch", { name: /automatic close/i });
    expect(toggles).toHaveLength(1);
    for (const toggle of toggles) {
      const describedBy = toggle.getAttribute("aria-describedby") ?? "";
      expect(describedBy.split(" ").filter(Boolean).length).toBe(2);
      for (const id of describedBy.split(" ").filter(Boolean)) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    }
  });
});
