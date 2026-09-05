// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY_LANGUAGE_STORAGE_KEY,
  LocalizationProvider,
  useLocalizationController,
} from "../../../localization/LocalizationContext";
import { OnboardingLanguageToggle } from "../OnboardingLanguageToggle";
import { WelcomeStep } from "./WelcomeStep";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function WelcomeHarness() {
  const controller = useLocalizationController();
  return (
    <LocalizationProvider controller={controller}>
      <WelcomeStep promotionActive={false} promotionEndsAt={null} />
      <OnboardingLanguageToggle />
    </LocalizationProvider>
  );
}

describe("WelcomeStep language policy", () => {
  it("renders the first screen in Korean for a fresh Korean-system user", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ko-KR", "en-US"]);

    render(<WelcomeHarness />);

    expect(screen.getByText("drifty에 오신 것을 환영합니다.")).toBeTruthy();
    expect(screen.getByText("타이머도 입력도 없습니다.")).toBeTruthy();
    expect(screen.getByText("일하는 동안 자동으로 기록하고, AI가 집중과 딴짓을 나눠서 보여줍니다.")).toBeTruthy();
    expect(screen.getByText("몇 단계만 설정하면 바로 시작됩니다.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "한국어" }).getAttribute("aria-checked")).toBe("true");
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("ko");
  });

  it("does not show the language toggle to non-Korean-system users", () => {
    render(<WelcomeHarness />);

    expect(screen.getByText("Welcome to drifty.")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("lets Korean-system users correct a stored English preference", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ko-KR", "en-US"]);
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");

    render(<WelcomeHarness />);

    expect(screen.getByText("Welcome to drifty.")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Language" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "한국어" }));

    expect(screen.getByText("drifty에 오신 것을 환영합니다.")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "언어" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "한국어" }).getAttribute("aria-checked")).toBe("true");
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("ko");
  });

  it("supports the radio-group keyboard interaction pattern", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ko-KR", "en-US"]);
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");

    render(<WelcomeHarness />);

    const englishOption = screen.getByRole("radio", { name: "English" });
    englishOption.focus();
    fireEvent.keyDown(englishOption, { key: "ArrowRight" });

    const koreanOption = screen.getByRole("radio", { name: "한국어" });
    expect(koreanOption.getAttribute("aria-checked")).toBe("true");
    expect(koreanOption.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(koreanOption);

    fireEvent.keyDown(koreanOption, { key: "Home" });

    const englishOptionAfterReset = screen.getByRole("radio", { name: "English" });
    expect(englishOptionAfterReset.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(englishOptionAfterReset);
  });
});
