// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
  it("selects Spanish from regional system tags and preserves an explicit choice", () => {
    expect(resolveSystemDisplayLanguage({ language: "es-MX", languages: ["es-MX", "en-US"] })).toBe("es");
    expect(resolveSystemDisplayLanguage({ language: "en-US", languages: ["en-US", "es-ES"] })).toBe("en");
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "es");
    expect(resolveInitialDisplayLanguage({ language: "ko-KR" })).toBe("es");
    render(<ControllerHarness />);
    expect(screen.getByText("Configuración")).toBeTruthy();
    expect(document.documentElement.lang).toBe("es");
  });

  it("uses preferred language rather than country or a lower-priority Spanish language", () => {
    expect(resolveSystemDisplayLanguage({ languages: ["en-MX", "es-MX"] })).toBe("en");
    expect(resolveSystemDisplayLanguage({ languages: ["es-US", "en-US"] })).toBe("es");
    expect(resolveSystemDisplayLanguage({ languages: ["fr-ES", "es-ES"] })).toBe("fr");
  });

  it("follows a changed system language until the user explicitly chooses one", () => {
    let preferredLanguages = ["en-US"];
    vi.spyOn(window.navigator, "languages", "get").mockImplementation(() => preferredLanguages);
    render(<ControllerHarness />);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBeNull();

    preferredLanguages = ["es-MX", "en-US"];
    act(() => window.dispatchEvent(new Event("languagechange")));
    expect(screen.getByText("Configuración")).toBeTruthy();
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle language" }));
    expect(screen.getByText("설정")).toBeTruthy();
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("ko");

    preferredLanguages = ["en-US"];
    act(() => window.dispatchEvent(new Event("languagechange")));
    expect(screen.getByText("설정")).toBeTruthy();
  });
  it("keeps a live manual choice during system changes when preference writes fail", () => {
    let preferredLanguages = ["en-US"];
    vi.spyOn(window.navigator, "languages", "get").mockImplementation(() => preferredLanguages);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Preference writes blocked", "SecurityError");
    });
    render(<ControllerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle language" }));
    expect(screen.getByText("설정")).toBeTruthy();

    preferredLanguages = ["es-MX"];
    act(() => window.dispatchEvent(new Event("languagechange")));
    expect(screen.getByText("설정")).toBeTruthy();
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it("retains deliberate legacy English when migration writes fail and the system changes", () => {
    window.localStorage.setItem("drifty.displayLanguage", "en");
    let preferredLanguages = ["ko-KR"];
    vi.spyOn(window.navigator, "languages", "get").mockImplementation(() => preferredLanguages);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Preference writes blocked", "SecurityError");
    });
    render(<ControllerHarness />);
    expect(screen.getByText("Settings")).toBeTruthy();

    preferredLanguages = ["es-ES"];
    act(() => window.dispatchEvent(new Event("languagechange")));
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it.each([["en-US", "en"], ["ja-JP", "ja"], ["de-DE", "de"]])("repairs the old implicit Korean default on a %s system", (language, expected) => {
    window.localStorage.setItem("drifty.displayLanguage", "ko");
    expect(resolveInitialDisplayLanguage({ language, languages: [language] })).toBe(expected);
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
    expect(screen.getByText("처음에는 이 기기의 첫 번째 선호 언어를 사용합니다. 여기서 선택한 언어는 계속 유지됩니다.")).toBeTruthy();
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
