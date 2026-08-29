// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DISPLAY_LANGUAGE_STORAGE_KEY,
  LEGACY_DISPLAY_LANGUAGE_STORAGE_KEY,
  LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY,
  LocalizationProvider,
  LocalizationTestProvider,
  useLocalization,
  useLocalizationController,
} from "./LocalizationContext";
import { GeneralSettingsSection } from "../settings/GeneralSettingsSection";

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

describe("display language", () => {
  it("defaults new users to English without guessing from their locale", () => {
    render(<ControllerHarness />);

    expect(screen.getByText("en")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("en");
  });

  it("activates Korean from the public language preference without Dev mode", () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");

    render(<ControllerHarness />);

    expect(screen.getByText("ko")).toBeTruthy();
    expect(screen.getByText("설정")).toBeTruthy();
    expect(document.documentElement.lang).toBe("ko");

    fireEvent.click(screen.getByRole("button", { name: "Toggle language" }));

    expect(screen.getByText("en")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("migrates users who explicitly opted into the legacy Korean preview", () => {
    window.localStorage.setItem(LEGACY_DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    window.localStorage.setItem(LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY, "1");

    render(<ControllerHarness />);

    expect(screen.getByText("ko")).toBeTruthy();
    expect(screen.getByText("설정")).toBeTruthy();
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("ko");
  });

  it("does not treat the old Korean default value as an explicit opt-in", () => {
    window.localStorage.setItem(LEGACY_DISPLAY_LANGUAGE_STORAGE_KEY, "ko");

    render(<ControllerHarness />);

    expect(screen.getByText("en")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("en");
  });

  it("always shows the display-language control in General settings", () => {
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
          onSendFeedback={() => undefined}
          onStartOfDayChange={() => undefined}
          onStartOfWeekChange={() => undefined}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByText("표시 언어")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "표시 언어" })).toBeTruthy();
    expect(screen.getByText("커뮤니티 및 지원")).toBeTruthy();
    expect(screen.getByText("Drifty 커뮤니티")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "피드백 보내기" })).toHaveLength(1);
    expect(screen.getByText("한국어 베타는 온보딩, 앱 메뉴, 설정 및 요금제 화면에 우선 적용됩니다. 일부 활동 및 분석 화면은 아직 영어로 표시됩니다.")).toBeTruthy();
  });
});
