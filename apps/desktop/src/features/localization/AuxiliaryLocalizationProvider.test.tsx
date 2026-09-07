// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AuxiliaryLocalizationProvider } from "./AuxiliaryLocalizationProvider";
import { useLocalization } from "./LocalizationContext";
import { DISPLAY_LANGUAGE_STORAGE_KEY } from "./languagePreference";
function Probe() { const { t } = useLocalization(); return <span>{t("companion.dayReview.title")}</span>; }
afterEach(() => { cleanup(); localStorage.clear(); });
it("follows cross-window changes and storage clearing without rewriting the preference", () => {
  localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
  render(<AuxiliaryLocalizationProvider><Probe /></AuxiliaryLocalizationProvider>);
  expect(screen.getByText("Day review")).toBeTruthy();
  act(() => {
    localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    window.dispatchEvent(new StorageEvent("storage", { key: DISPLAY_LANGUAGE_STORAGE_KEY, newValue: "ko" }));
  });
  expect(screen.getByText("하루 리뷰")).toBeTruthy();
  expect(document.documentElement.lang).toBe("ko");
  act(() => {
    localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
    window.dispatchEvent(new StorageEvent("storage", { key: DISPLAY_LANGUAGE_STORAGE_KEY, newValue: "en" }));
  });
  expect(screen.getByText("Day review")).toBeTruthy();
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
  expect(localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBeNull();
});
