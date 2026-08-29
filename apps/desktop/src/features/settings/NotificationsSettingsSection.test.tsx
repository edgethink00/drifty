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
    expect(badges).toHaveLength(2);
    expect(badges.every((badge) => badge.className.includes("status-badge--beta"))).toBe(true);
    expect(badges.every((badge) => badge.getAttribute("aria-hidden") === null)).toBe(true);
  });

  it("localizes the production pet settings in Korean", () => {
    renderSettings({ showPetNewBadge: true }, "ko");

    expect(screen.getByRole("group", { name: "컴패니언 표시" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "1시간 숨기기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "끄기" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "데스크톱 펫" })).toBeTruthy();
    expect(screen.getByText("신규")).toBeTruthy();
    expect(screen.getAllByText("베타").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("New")).toBeNull();
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.getByText("펫 표시")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "펫 크기" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "아이보리" })).toBeTruthy();
  });

  it("mirrors Automatic close between Drift alerts and Desktop pet", () => {
    const props = renderSettings({ driftAlertsEnabled: true, extremeNudgeEnabled: false });

    const toggles = screen.getAllByRole("switch", { name: /automatic close/i });
    expect(toggles).toHaveLength(2);
    expect(toggles.every((toggle) => toggle.getAttribute("aria-checked") === "false")).toBe(true);

    fireEvent.click(toggles[1]!);
    expect(props.onExtremeNudgeChange).toHaveBeenCalledWith(true);
  });

  it("disables both Automatic close toggles until Drift alerts are on", () => {
    renderSettings({ driftAlertsEnabled: false, extremeNudgeEnabled: true });

    const toggles = screen.getAllByRole("switch", { name: /automatic close/i });
    expect(toggles).toHaveLength(2);
    expect(toggles.every((toggle) => toggle.hasAttribute("disabled"))).toBe(true);
    expect(screen.getAllByText(/Turn on Drift alerts before enabling Automatic close\./).length).toBe(2);
  });

  it("keeps Automatic close available while the pet is off", () => {
    renderSettings({ petModeEnabled: false, driftAlertsEnabled: true, extremeNudgeEnabled: true });

    expect(screen.getByText(
      "Closes supported distracting tabs and apps without the pet animation. Communication activity stays open. Shared with Drift alerts.",
    )).toBeTruthy();
    expect(screen.getAllByText(
      "Closes supported distracting tabs and apps. Communication activity stays open. Shared with Desktop pet.",
    )).toHaveLength(1);
    const toggles = screen.getAllByRole("switch", { name: /automatic close/i });
    expect(toggles).toHaveLength(2);
    expect(toggles.every((toggle) => toggle.getAttribute("aria-checked") === "true")).toBe(true);
    expect(toggles.every((toggle) => toggle.hasAttribute("disabled") === false)).toBe(true);
  });

  it("states the Automatic close communication exception in Korean", () => {
    renderSettings({ driftAlertsEnabled: true, extremeNudgeEnabled: true }, "ko");

    expect(screen.getAllByText(
      "지원되는 딴짓 탭과 앱을 닫습니다. 커뮤니케이션 활동은 닫지 않습니다. 데스크톱 펫과 같은 설정입니다.",
    )).toHaveLength(1);
    expect(screen.getByText(
      "펫 애니메이션 없이 지원되는 딴짓 탭과 앱을 닫습니다. 커뮤니케이션 활동은 닫지 않습니다. 딴짓 알림과 같은 설정입니다.",
    )).toBeTruthy();
  });

  it("connects each Automatic close switch to its row copy", () => {
    renderSettings({ driftAlertsEnabled: true, extremeNudgeEnabled: false });

    const toggles = screen.getAllByRole("switch", { name: /automatic close/i });
    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) {
      const describedBy = toggle.getAttribute("aria-describedby") ?? "";
      expect(describedBy.split(" ").filter(Boolean).length).toBe(2);
      for (const id of describedBy.split(" ").filter(Boolean)) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    }
  });
});
