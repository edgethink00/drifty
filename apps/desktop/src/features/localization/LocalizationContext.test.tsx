// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DISPLAY_LANGUAGE_STORAGE_KEY,
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
  it("keeps Korean users in English when the preview or Dev mode is off", () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    window.localStorage.setItem(KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");

    render(<ControllerHarness />);

    expect(screen.getByText("en")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("activates Korean only when both Dev mode and the preview are enabled", () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    window.localStorage.setItem(KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");

    render(<ControllerHarness />);

    expect(screen.getByText("ko")).toBeTruthy();
    expect(screen.getByText("설정")).toBeTruthy();
    expect(document.documentElement.lang).toBe("ko");

    fireEvent.click(screen.getByRole("button", { name: "Toggle preview" }));
    expect(screen.getByText("en")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("shows the display-language control inside General only for the preview", () => {
    render(
      <LocalizationTestProvider language="ko">
        <GeneralSettingsSection
          autoInstallFutureUpdates={false}
          startOfDayValue="04:00"
          startOfWeek="monday"
          updaterChecking={false}
          updaterError={null}
          updaterInstalling={false}
          updaterMessage={null}
          onAutoInstallFutureUpdatesChange={() => undefined}
          onCheckForUpdates={() => undefined}
          onStartOfDayChange={() => undefined}
          onStartOfWeekChange={() => undefined}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByText("표시 언어")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "표시 언어" })).toBeTruthy();
    expect(screen.getByText("한국어 미리보기는 베타이며 현재 온보딩과 주요 설정에만 적용됩니다. 여기서 영어를 선택하거나 개발자 설정에서 한국어 미리보기를 끄면 영어로 돌아갑니다.")).toBeTruthy();
  });
});
