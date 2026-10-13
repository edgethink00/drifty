// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDefaultDriftAlarmCopy } from "../companion/driftAlarmCopy";
import { DEFAULT_QUIET_HOURS } from "../companion/quietHours";
import { NotificationsSettingsSection } from "./NotificationsSettingsSection";
import { LocalizationTestProvider, type DisplayLanguage } from "../localization/LocalizationContext";

const nativeNotifications = vi.hoisted(() => ({ authorization: "unavailable" as string }));
vi.mock("../../lib/api/nativeNotificationClient", () => ({
  readNativeNotificationAuthorization: async () => nativeNotifications.authorization,
  requestNativeNotificationAuthorization: async () => nativeNotifications.authorization,
}));

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
    macosNotificationEnabled: false,
    celebrationsEnabled: true,
    dayReviewEnabled: true,
    dayReviewTimeValue: "20:00",
    quietHours: DEFAULT_QUIET_HOURS,
    onDriftAlertDelaySecondsChange: vi.fn(),
    onDriftAlarmCopyOverridesChange: vi.fn(),
    onDriftAlertsChange: vi.fn(),
    onExtremeNudgeChange: vi.fn(),
    onMacosNotificationChange: vi.fn(),
    onCelebrationsChange: vi.fn(),
    onDayReviewEnabledChange: vi.fn(),
    onDayReviewTimeChange: vi.fn(),
    onQuietHoursChange: vi.fn(),
    requestNotificationPermission: vi.fn(async () => "granted" as const),
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
  afterEach(() => {
    cleanup();
    nativeNotifications.authorization = "unavailable";
  });

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

  it("hides inactive timing but keeps alert wording while Drift alerts are off", () => {
    renderSettings({ driftAlertsEnabled: false, extremeNudgeEnabled: false });

    const timingRow = document.querySelector('[data-setting-id="settings.notifications.timing"]');
    const wordingRow = document.querySelector('[data-setting-id="settings.alarmCopy.label"]');
    expect(timingRow).toBeNull();
    expect(wordingRow?.classList.contains("settings-row--disabled")).toBe(true);
    expect(screen.queryByRole("combobox", { name: "Drift alert timing" })).toBeNull();
    expect((screen.getByRole("button", { name: "Edit alert wording" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps timing and wording active while Drift alerts are on and lists each delay once", () => {
    renderSettings({ driftAlertsEnabled: true });

    const timingRow = document.querySelector('[data-setting-id="settings.notifications.timing"]');
    expect(timingRow?.classList.contains("settings-row--disabled")).toBe(false);
    const trigger = screen.getByRole("combobox", { name: "Drift alert timing" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "1m" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Instant" })).toBeTruthy();
    expect(screen.queryByText("After 1 minute of drift")).toBeNull();
  });

  it("asks macOS for permission when the notification switch is turned on and reports a denial", async () => {
    const requestNotificationPermission = vi.fn(async () => "denied" as const);
    const openNotificationSettings = vi.fn(async () => true);
    const props = renderSettings({ driftAlertsEnabled: true, requestNotificationPermission, openNotificationSettings });

    const toggle = screen.getByRole("switch", { name: "Toggle macOS notifications" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);

    expect(props.onMacosNotificationChange).toHaveBeenCalledWith(true);
    expect(requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Notifications are turned off for Drifty in macOS.");

    // The fix is one click away instead of a trip to another settings page.
    fireEvent.click(screen.getByRole("button", { name: /Open System Settings/ }));
    expect(openNotificationSettings).toHaveBeenCalledTimes(1);
  });

  it("names Windows Settings in the denial shortcut on Windows", async () => {
    const openNotificationSettings = vi.fn(async () => true);
    renderSettings({
      driftAlertsEnabled: true,
      hostPlatform: "windows",
      requestNotificationPermission: vi.fn(async () => "denied" as const),
      openNotificationSettings,
    }, "ko");

    fireEvent.click(screen.getByRole("switch", { name: /Windows/ }));

    expect((await screen.findByRole("alert")).textContent).toBe("Windows에서 Drifty 알림이 꺼져 있습니다.");
    fireEvent.click(screen.getByRole("button", { name: /Windows 설정 열기/ }));
    expect(openNotificationSettings).toHaveBeenCalledTimes(1);
  });

  it("hides inactive macOS delivery without resetting its saved choice", () => {
    const props = renderSettings({ driftAlertsEnabled: false, macosNotificationEnabled: true, driftAlertDelaySeconds: 300 });
    expect(screen.queryByRole("switch", { name: "Toggle macOS notifications" })).toBeNull();
    expect(props.onMacosNotificationChange).not.toHaveBeenCalled();
    expect(props.onDriftAlertDelaySecondsChange).not.toHaveBeenCalled();
    cleanup();
    renderSettings({ driftAlertsEnabled: true, macosNotificationEnabled: true, driftAlertDelaySeconds: 300 });
    expect(screen.getByRole("switch", { name: "Toggle macOS notifications" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Drift alert timing" }).textContent).toContain("5m");
  });

  it("offers celebration and day review switches with the review time beside them", () => {
    const props = renderSettings({ dayReviewEnabled: false });

    fireEvent.click(screen.getByRole("switch", { name: "Toggle focus celebrations" }));
    expect(props.onCelebrationsChange).toHaveBeenCalledWith(false);

    const reviewTime = screen.getByRole("combobox", { name: "Day review at" }) as HTMLButtonElement;
    expect(reviewTime.disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Toggle the day review" }));
    expect(props.onDayReviewEnabledChange).toHaveBeenCalledWith(true);
  });

  it("says the day review cannot arrive while notifications are off for Drifty, and only then", async () => {
    nativeNotifications.authorization = "denied";
    const openNotificationSettings = vi.fn(async () => true);
    renderSettings({ openNotificationSettings });

    const dayReviewRow = document.querySelector('[data-setting-id="settings.moments.dayReview"]');
    if (!(dayReviewRow instanceof HTMLElement)) throw new Error("day review row missing");
    expect((await within(dayReviewRow).findByRole("alert")).textContent).toBe("Notifications are off for Drifty, so the review cannot arrive.");
    fireEvent.click(within(dayReviewRow).getByRole("button", { name: /Open System Settings/ }));
    expect(openNotificationSettings).toHaveBeenCalledTimes(1);

    cleanup();
    renderSettings({ dayReviewEnabled: false });
    await Promise.resolve();
    const offRow = document.querySelector('[data-setting-id="settings.moments.dayReview"]');
    expect(offRow?.querySelector('[role="alert"]')).toBeNull();
  });

  it("hides quiet-hour times until the window is on, and never lets start equal end", () => {
    const props = renderSettings();
    expect(screen.queryByRole("combobox", { name: "Starts at" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Ends at" })).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Toggle quiet hours" }));
    expect(props.onQuietHoursChange).toHaveBeenLastCalledWith({ enabled: true, startMinute: 22 * 60, endMinute: 8 * 60 });

    cleanup();
    const enabledProps = renderSettings({ quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 8 * 60 } });
    expect(screen.getByText(/Quiet from 10:00 PM to 8:00 AM/)).toBeTruthy();
    const end = screen.getByRole("combobox", { name: "Ends at" }) as HTMLButtonElement;
    expect(end.disabled).toBe(false);
    fireEvent.click(end);
    fireEvent.click(screen.getByRole("option", { name: "10:00 PM" }));
    expect(enabledProps.onQuietHoursChange).toHaveBeenLastCalledWith({ enabled: true, startMinute: 22 * 60, endMinute: 22 * 60 + 30 });
  });

  it("keeps pet appearance out of alerts and exposes one automatic-close control that asks before turning on", async () => {
    const props = renderSettings({ driftAlertsEnabled: false, extremeNudgeEnabled: false });
    expect(screen.queryByRole("heading", { name: "Desktop pet" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Pet coat" })).toBeNull();
    const toggles = screen.getAllByRole("switch", { name: /automatic close/i });
    expect(toggles).toHaveLength(1);
    fireEvent.click(toggles[0]!);
    // The same consent as the post-setup intro: nothing changes until Turn on.
    const popup = await screen.findByRole("alertdialog", { name: "Turn on Automatic close?" });
    expect(props.onExtremeNudgeChange).not.toHaveBeenCalled();
    expect(props.onDriftAlertsChange).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(within(popup).getByRole("button", { name: "Keep off" })));
    fireEvent.click(within(popup).getByRole("button", { name: "Keep off" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(props.onExtremeNudgeChange).not.toHaveBeenCalled();

    fireEvent.click(toggles[0]!);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Turn on" }));
    expect(props.onDriftAlertsChange).toHaveBeenCalledWith(true);
    expect(props.onExtremeNudgeChange).toHaveBeenCalledWith(true);
  });

  it("shows the desktop cat closing the tab in the consent preview only when the cat is on", async () => {
    renderSettings({ driftAlertsEnabled: true, extremeNudgeEnabled: false, petEnabled: true });
    fireEvent.click(screen.getByRole("switch", { name: /automatic close/i }));
    const popup = await screen.findByRole("alertdialog", { name: "Turn on Automatic close?" });
    expect(popup.querySelector(".close-preview__cat")).toBeTruthy();
    cleanup();
    renderSettings({ driftAlertsEnabled: true, extremeNudgeEnabled: false, petEnabled: false });
    fireEvent.click(screen.getByRole("switch", { name: /automatic close/i }));
    expect((await screen.findByRole("alertdialog")).querySelector(".close-preview__cat")).toBeNull();
  });

  it("turns Automatic close off without asking", () => {
    const props = renderSettings({ driftAlertsEnabled: true, extremeNudgeEnabled: true });
    fireEvent.click(screen.getByRole("switch", { name: /automatic close/i }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(props.onExtremeNudgeChange).toHaveBeenCalledWith(false);
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

  it("uses Windows notification copy on Windows without leaking macOS terminology", () => {
    renderSettings({ hostPlatform: "windows" });

    expect(screen.getByText("Also send a Windows notification")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Toggle Windows notifications" })).toBeTruthy();
    expect(screen.getByText("Customize the wording shown across Drift alerts, Windows notifications, and Automatic close.")).toBeTruthy();
    expect(screen.queryByText("Also send a macOS notification")).toBeNull();
    expect(screen.queryByText(/macOS notifications/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit alert wording" }));
    expect(screen.getByRole("tab", { name: "Windows notification" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "macOS notification" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Windows notification" }));
    expect(screen.getByText("Shown by Windows when Drifty sends a background drift notification.")).toBeTruthy();
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
