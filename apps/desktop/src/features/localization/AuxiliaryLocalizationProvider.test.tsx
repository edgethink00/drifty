// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuxiliaryLocalizationProvider } from "./AuxiliaryLocalizationProvider";
import { useLocalization } from "./LocalizationContext";
import { DISPLAY_LANGUAGE_STORAGE_KEY } from "./languagePreference";
function Probe() { const { t } = useLocalization(); return <span>{t("companion.dayReview.title")}</span>; }
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
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

it("follows a system language change when no explicit preference is stored", () => {
  let preferredLanguages = ["en-US"];
  vi.spyOn(window.navigator, "languages", "get").mockImplementation(() => preferredLanguages);
  render(<AuxiliaryLocalizationProvider><Probe /></AuxiliaryLocalizationProvider>);
  expect(document.documentElement.lang).toBe("en");

  preferredLanguages = ["es-MX"];
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(document.documentElement.lang).toBe("es");
  expect(localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBeNull();
});
