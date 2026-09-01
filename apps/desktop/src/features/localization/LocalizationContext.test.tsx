// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DISPLAY_LANGUAGE_STORAGE_KEY,
  LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY,
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
  const { effectiveLanguage, setDisplayLanguage, t } = useLocalization();
  return (
    <div>
      <span>{effectiveLanguage}</span>
      <span>{t("common.settings")}</span>
      <button type="button" onClick={() => setDisplayLanguage(effectiveLanguage === "ko" ? "en" : "ko")}>Toggle language</button>
    </div>
  );
}

function GeneralSettingsHarness() {
  const controller = useLocalizationController();
  return (
    <LocalizationProvider controller={controller}>
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
    </LocalizationProvider>
  );
}

describe("display language preference", () => {
  it("defaults every public surface to English", () => {
    render(<ControllerHarness />);

    expect(screen.getByText("en")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps an explicit Korean preference independently of Dev mode", () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");

    render(<ControllerHarness />);

    expect(screen.getByText("ko")).toBeTruthy();
    expect(screen.getByText("설정")).toBeTruthy();
    expect(document.documentElement.lang).toBe("ko");
  });

  it("migrates the previously enabled Dev preview to the durable language preference", () => {
    window.localStorage.setItem(LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");

    render(<ControllerHarness />);

    expect(screen.getByText("ko")).toBeTruthy();
    expect(screen.getByText("설정")).toBeTruthy();
    expect(document.documentElement.lang).toBe("ko");
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("ko");
    expect(window.localStorage.getItem(LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY)).toBeNull();
  });

  it("changes language immediately from General settings and persists the choice", () => {
    render(<GeneralSettingsHarness />);

    const languageSelect = screen.getByRole("combobox", { name: "Language" });
    expect(languageSelect.textContent).toContain("English");
    fireEvent.click(languageSelect);
    fireEvent.click(screen.getByRole("option", { name: "Korean (Beta)" }));

    expect(screen.getByRole("combobox", { name: "언어" }).textContent).toContain("한국어 (베타)");
    expect(screen.getByText("이 Mac에서 Drifty에 사용할 언어를 선택합니다.")).toBeTruthy();
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("ko");
    expect(document.documentElement.lang).toBe("ko");
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
