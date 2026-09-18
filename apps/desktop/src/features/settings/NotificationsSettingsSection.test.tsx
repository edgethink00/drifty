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
    driftAlertDelaySeconds: 60 as const,
    driftAlertsEnabled: true,
    driftAlarmCopy: buildDefaultDriftAlarmCopy(),
    driftAlarmCopyDefaults: buildDefaultDriftAlarmCopy(),
    extremeNudgeEnabled: false,
    onDriftAlertDelaySecondsChange: vi.fn(),
    onDriftAlarmCopyOverridesChange: vi.fn(),
    onDriftAlertsChange: vi.fn(),
    onExtremeNudgeChange: vi.fn(),
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

  it("opens with the section title and no resident Companion controls", () => {
    renderSettings();

    expect(screen.getByRole("heading", { name: "Companion & Alerts" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Companion visibility" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide for 1 hour" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Turn off" })).toBeNull();
  });

  it("shows a persistent Beta status label on Automatic close", () => {
    renderSettings();
    const badges = screen.getAllByText("Beta");
    expect(badges).toHaveLength(1);
    expect(badges.every((badge) => badge.className.includes("status-badge--beta"))).toBe(true);
    expect(badges.every((badge) => badge.getAttribute("aria-hidden") === null)).toBe(true);
  });

  it("reads timing and wording as inactive while Drift alerts are off", () => {
    renderSettings({ driftAlertsEnabled: false, extremeNudgeEnabled: false });

    const timingRow = document.querySelector('[data-setting-id="settings.notifications.timing"]');
    const wordingRow = document.querySelector('[data-setting-id="settings.alarmCopy.label"]');
    expect(timingRow?.classList.contains("settings-row--disabled")).toBe(true);
    expect(wordingRow?.classList.contains("settings-row--disabled")).toBe(true);
    expect((screen.getByRole("combobox", { name: "Drift alert timing" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Edit alert wording" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps timing and wording active while Drift alerts are on and explains each delay", () => {
    renderSettings({ driftAlertsEnabled: true });

    const timingRow = document.querySelector('[data-setting-id="settings.notifications.timing"]');
    expect(timingRow?.classList.contains("settings-row--disabled")).toBe(false);
    const trigger = screen.getByRole("combobox", { name: "Drift alert timing" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    fireEvent.click(trigger);
    expect(screen.getByText("After 1 minute of drift")).toBeTruthy();
    expect(screen.getByText("As soon as drift is detected")).toBeTruthy();
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
    expect(screen.getByText("지원되는 딴짓 탭과 앱을 닫습니다. 커뮤니케이션 활동은 닫지 않습니다.")).toBeTruthy();
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
