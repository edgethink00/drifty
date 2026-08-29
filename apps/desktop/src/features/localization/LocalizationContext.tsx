import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS, type TranslationKey } from "./translations";
import {
  DISPLAY_LANGUAGE_STORAGE_KEY,
  resolveInitialDisplayLanguage,
  type DisplayLanguage,
} from "./languagePreference";

export {
  DISPLAY_LANGUAGE_STORAGE_KEY,
  LEGACY_DISPLAY_LANGUAGE_STORAGE_KEY,
  LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY,
  resolveInitialDisplayLanguage,
  type DisplayLanguage,
} from "./languagePreference";

type TranslationParams = Readonly<Record<string, string | number>>;

export type LocalizationController = {
  readonly displayLanguage: DisplayLanguage;
  readonly effectiveLanguage: DisplayLanguage;
  readonly setDisplayLanguage: (language: DisplayLanguage) => void;
  readonly t: (key: TranslationKey, params?: TranslationParams) => string;
};

const englishController: LocalizationController = {
  displayLanguage: "en",
  effectiveLanguage: "en",
  setDisplayLanguage: () => undefined,
  t: (key, params) => interpolate(ENGLISH_TRANSLATIONS[key], params),
};

const LocalizationContext = createContext<LocalizationController>(englishController);

export function useLocalization(): LocalizationController {
  return useContext(LocalizationContext);
}

export function useLocalizationController(): LocalizationController {
  const [displayLanguage, setDisplayLanguage] = useState<DisplayLanguage>(resolveInitialDisplayLanguage);
  const effectiveLanguage = displayLanguage;

  useEffect(() => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, displayLanguage);
  }, [displayLanguage]);

  useEffect(() => {
    document.documentElement.lang = effectiveLanguage;
    document.documentElement.dataset.locale = effectiveLanguage;
  }, [effectiveLanguage]);

  return useMemo(() => ({
    displayLanguage,
    effectiveLanguage,
    setDisplayLanguage,
    t: (key: TranslationKey, params?: TranslationParams) => interpolate(
      effectiveLanguage === "ko" ? KOREAN_TRANSLATIONS[key] : ENGLISH_TRANSLATIONS[key],
      params,
    ),
  }), [displayLanguage, effectiveLanguage]);
}

export function LocalizationProvider({ children, controller }: { readonly children: ReactNode; readonly controller: LocalizationController }) {
  return <LocalizationContext.Provider value={controller}>{children}</LocalizationContext.Provider>;
}

export function LocalizationTestProvider({ children, language = "ko" }: { readonly children: ReactNode; readonly language?: DisplayLanguage }) {
  const controller = useMemo<LocalizationController>(() => ({
    displayLanguage: language,
    effectiveLanguage: language,
    setDisplayLanguage: () => undefined,
    t: (key, params) => interpolate(language === "ko" ? KOREAN_TRANSLATIONS[key] : ENGLISH_TRANSLATIONS[key], params),
  }), [language]);
  return <LocalizationContext.Provider value={controller}>{children}</LocalizationContext.Provider>;
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/gu, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
