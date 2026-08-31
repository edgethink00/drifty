// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY,
  LocalizationProvider,
  LocalizationTestProvider,
  useLocalization,
  useLocalizationController,
} from "./LocalizationContext";
import { GeneralSettingsSection } from "../settings/GeneralSettingsSection";
import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = "en";
  delete document.documentElement.dataset.locale;
});

afterEach(cleanup);

function ControllerHarness() {
  const controller = useLocalizationController();
  return (
    <LocalizationProvider controller={controller}>
      <ControllerState />
    </LocalizationProvider>
  );
}

function ControllerState() {
  const { effectiveLanguage, koreanPreviewEnabled, setKoreanPreviewEnabled, t } = useLocalization();
  return (
    <div>
      <span>{effectiveLanguage}</span>
      <span>{t("common.settings")}</span>
      <button type="button" onClick={() => setKoreanPreviewEnabled(!koreanPreviewEnabled)}>Toggle preview</button>
    </div>
  );
}

describe("Korean localization preview", () => {
  it("defaults every public surface to English", () => {
    render(<ControllerHarness />);

    expect(screen.getByText("en")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps the app in English when the preview was stored but Dev mode is off", () => {
    window.localStorage.setItem(KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");

    render(<ControllerHarness />);

    expect(screen.getByText("en")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("activates Korean only when Dev mode and its preview toggle are enabled", () => {
    window.localStorage.setItem(KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");

    render(<ControllerHarness />);

    expect(screen.getByText("ko")).toBeTruthy();
    expect(screen.getByText("설정")).toBeTruthy();
    expect(document.documentElement.lang).toBe("ko");

    fireEvent.click(screen.getByRole("button", { name: "Toggle preview" }));

    expect(screen.getByText("en")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(window.localStorage.getItem(KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY)).toBe("0");
  });

  it("does not expose a language control in General settings", () => {
    render(
      <LocalizationTestProvider language="ko">
        <GeneralSettingsSection
          backgroundUpdatesEnabled={false}
          backgroundUpdatesSupported
          startOfDayValue="04:00"
          startOfWeek="monday"
          updaterChecking={false}
          updaterError={null}
          updaterInstalling={false}
          updaterMessage={null}
          onBackgroundUpdatesEnabledChange={() => undefined}
          onCheckForUpdates={() => undefined}
          onStartOfDayChange={() => undefined}
          onStartOfWeekChange={() => undefined}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.queryByText("표시 언어")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "표시 언어" })).toBeNull();
    expect(screen.queryByText("커뮤니티 및 지원")).toBeNull();
    expect(screen.queryByText("Drifty 커뮤니티")).toBeNull();
  });

  it("hides macOS-only background update preparation on unsupported platforms", () => {
    render(
      <LocalizationTestProvider language="en">
        <GeneralSettingsSection
          backgroundUpdatesEnabled
          backgroundUpdatesSupported={false}
          startOfDayValue="04:00"
          startOfWeek="monday"
          updaterChecking={false}
          updaterError={null}
          updaterInstalling={false}
          updaterMessage={null}
          onBackgroundUpdatesEnabledChange={() => undefined}
          onCheckForUpdates={() => undefined}
          onStartOfDayChange={() => undefined}
          onStartOfWeekChange={() => undefined}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.queryByRole("switch", { name: "Automatically update Drifty" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check for Updates" })).toBeTruthy();
  });
});
