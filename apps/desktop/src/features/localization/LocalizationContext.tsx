import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TranslationKey } from "./translations";
import { translateFor, type TranslationParams } from "./translate";
import {
  DISPLAY_LANGUAGE_STORAGE_KEY,
  LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY,
  resolveInitialDisplayLanguage,
  resolveSystemDisplayLanguage,
  type DisplayLanguage,
} from "./languagePreference";

export {
  DISPLAY_LANGUAGE_STORAGE_KEY,
  LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY,
  resolveInitialDisplayLanguage,
  resolveSystemDisplayLanguage,
  type DisplayLanguage,
} from "./languagePreference";

export type LocalizationController = {
  readonly effectiveLanguage: DisplayLanguage;
  readonly setDisplayLanguage: (language: DisplayLanguage) => void;
  readonly t: (key: TranslationKey, params?: TranslationParams) => string;
};

const englishController: LocalizationController = {
  effectiveLanguage: "en",
  setDisplayLanguage: () => undefined,
  t: translateFor("en"),
};

const LocalizationContext = createContext<LocalizationController>(englishController);

export function useLocalization(): LocalizationController {
  return useContext(LocalizationContext);
}

export function useLocalizationController(): LocalizationController {
  const [effectiveLanguage, setDisplayLanguage] = useState<DisplayLanguage>(resolveInitialDisplayLanguage);

  useEffect(() => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, effectiveLanguage);
    window.localStorage.removeItem(LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY);
  }, [effectiveLanguage]);

  useEffect(() => {
    document.documentElement.lang = effectiveLanguage;
    document.documentElement.dataset.locale = effectiveLanguage;
  }, [effectiveLanguage]);

  return useMemo(() => ({
    effectiveLanguage,
    setDisplayLanguage,
    t: translateFor(effectiveLanguage),
  }), [effectiveLanguage]);
}

export function LocalizationProvider({ children, controller }: { readonly children: ReactNode; readonly controller: LocalizationController }) {
  return <LocalizationContext.Provider value={controller}>{children}</LocalizationContext.Provider>;
}

export function LocalizationTestProvider({ children, language = "ko" }: { readonly children: ReactNode; readonly language?: DisplayLanguage }) {
  const controller = useMemo<LocalizationController>(() => ({
    effectiveLanguage: language,
    setDisplayLanguage: () => undefined,
    t: translateFor(language),
  }), [language]);
  return <LocalizationContext.Provider value={controller}>{children}</LocalizationContext.Provider>;
}
