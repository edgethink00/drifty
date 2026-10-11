// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DISPLAY_LANGUAGE_STORAGE_KEY,
  LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY,
  LocalizationProvider,
  LocalizationTestProvider,
  resolveInitialDisplayLanguage,
  resolveSystemDisplayLanguage,
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
  it.each(["en-US", "ja-JP", "de-DE"])("repairs the old implicit Korean default on a %s system", (language) => {
    window.localStorage.setItem("drifty.displayLanguage", "ko");
    expect(resolveInitialDisplayLanguage({ language, languages: [language] })).toBe("en");
  });

  it("preserves English from the unversioned preference on Korean systems", () => {
    window.localStorage.setItem("drifty.displayLanguage", "en");
    expect(resolveInitialDisplayLanguage({ language: "ko-KR" })).toBe("en");
  });

  it("preserves the safe v2 preference over the old implicit Korean value", () => {
    window.localStorage.setItem("drifty.displayLanguage", "ko");
    window.localStorage.setItem("drifty.displayLanguage.v2", "en");
    expect(resolveInitialDisplayLanguage({ language: "ko-KR" })).toBe("en");
  });

  it("repairs an upgraded controller and keeps a subsequent Korean choice after restart", () => {
    window.localStorage.setItem("drifty.displayLanguage", "ko");
    const first = render(<ControllerHarness />);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    fireEvent.click(screen.getByRole("button", { name: "Toggle language" }));
    expect(screen.getByText("설정")).toBeTruthy();
    first.unmount();
    render(<ControllerHarness />);
    expect(screen.getByText("설정")).toBeTruthy();
    expect(document.documentElement.lang).toBe("ko");
  });

  it("defaults Korean-system users to Korean on first launch", () => {
    expect(resolveInitialDisplayLanguage({
      language: "ko-KR",
      languages: ["ko-KR", "en-US"],
    })).toBe("ko");
  });

  it("uses only the system's first preferred language when available", () => {
    expect(resolveSystemDisplayLanguage({
      language: "ko-KR",
      languages: ["en-US", "ko-KR"],
    })).toBe("en");
    expect(resolveSystemDisplayLanguage({
      language: "en-KR",
      languages: ["en-KR"],
    })).toBe("en");
  });

  it("recognizes Korean language tags independently of region and separator style", () => {
    expect(resolveSystemDisplayLanguage({ language: "ko", languages: [] })).toBe("ko");
    expect(resolveSystemDisplayLanguage({ language: "ko-US", languages: [] })).toBe("ko");
    expect(resolveSystemDisplayLanguage({ language: "ko_KR", languages: [] })).toBe("ko");
  });

  it("falls back to English when the system language is missing or unreadable", () => {
    expect(resolveSystemDisplayLanguage({ language: "", languages: [] })).toBe("en");
    expect(resolveSystemDisplayLanguage({
      get language(): string {
        throw new Error("language unavailable");
      },
    })).toBe("en");
  });

  it("keeps an explicit English preference on a Korean system", () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");

    expect(resolveInitialDisplayLanguage({
      language: "ko-KR",
      languages: ["ko-KR"],
    })).toBe("en");
  });

  it("defaults non-Korean public surfaces to English", () => {
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
    fireEvent.click(screen.getByRole("option", { name: "Korean" }));

    expect(screen.getByRole("combobox", { name: "언어" }).textContent).toContain("한국어");
    expect(screen.getByText("이 기기에서 Drifty에 사용할 언어를 선택합니다.")).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeTruthy();
  });

  it("offers the release-build Developer mode control only on Windows", () => {
    const onDevModeChange = vi.fn();
    const { rerender } = render(
      <LocalizationTestProvider language="en">
        <GeneralSettingsSection
          backgroundUpdatesEnabled={false}
          backgroundUpdatesSupported={false}
          devModeEnabled={false}
          hostPlatform="windows"
          showDevMode
          startOfDayValue="04:00"
          startOfWeek="monday"
          updaterChecking={false}
          updaterError={null}
          updaterInstalling={false}
          updaterMessage={null}
          onBackgroundUpdatesEnabledChange={() => undefined}
          onCheckForUpdates={() => undefined}
          onDevModeChange={onDevModeChange}
          onStartOfDayChange={() => undefined}
          onStartOfWeekChange={() => undefined}
        />
      </LocalizationTestProvider>,
    );

    const toggle = screen.getByRole("switch", { name: "Developer mode" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/Windows beta channel/i)).toBeTruthy();
    fireEvent.click(toggle);
    expect(onDevModeChange).toHaveBeenCalledWith(true);

    rerender(
      <LocalizationTestProvider language="en">
        <GeneralSettingsSection
          backgroundUpdatesEnabled={false}
          backgroundUpdatesSupported={false}
          hostPlatform="macos"
          showDevMode
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
    expect(screen.queryByRole("switch", { name: "Developer mode" })).toBeNull();
  });
});
