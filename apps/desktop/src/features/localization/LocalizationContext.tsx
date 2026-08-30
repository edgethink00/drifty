import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS, type TranslationKey } from "./translations";
import {
  KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY,
  resolveInitialKoreanPreviewEnabled,
  type DisplayLanguage,
} from "./languagePreference";

export {
  KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY,
  resolveInitialDisplayLanguage,
  resolveInitialKoreanPreviewEnabled,
  type DisplayLanguage,
} from "./languagePreference";

type TranslationParams = Readonly<Record<string, string | number>>;

export type LocalizationController = {
  readonly effectiveLanguage: DisplayLanguage;
  readonly koreanPreviewEnabled: boolean;
  readonly setKoreanPreviewEnabled: (enabled: boolean) => void;
  readonly t: (key: TranslationKey, params?: TranslationParams) => string;
};

const englishController: LocalizationController = {
  effectiveLanguage: "en",
  koreanPreviewEnabled: false,
  setKoreanPreviewEnabled: () => undefined,
  t: (key, params) => interpolate(ENGLISH_TRANSLATIONS[key], params),
};

const LocalizationContext = createContext<LocalizationController>(englishController);

export function useLocalization(): LocalizationController {
  return useContext(LocalizationContext);
}

export function useLocalizationController(): LocalizationController {
  const [koreanPreviewEnabled, setKoreanPreviewEnabled] = useState(resolveInitialKoreanPreviewEnabled);
  const effectiveLanguage: DisplayLanguage = koreanPreviewEnabled ? "ko" : "en";

  useEffect(() => {
    window.localStorage.setItem(KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY, koreanPreviewEnabled ? "1" : "0");
  }, [koreanPreviewEnabled]);

  useEffect(() => {
    document.documentElement.lang = effectiveLanguage;
    document.documentElement.dataset.locale = effectiveLanguage;
  }, [effectiveLanguage]);

  return useMemo(() => ({
    effectiveLanguage,
    koreanPreviewEnabled,
    setKoreanPreviewEnabled,
    t: (key: TranslationKey, params?: TranslationParams) => interpolate(
      effectiveLanguage === "ko" ? KOREAN_TRANSLATIONS[key] : ENGLISH_TRANSLATIONS[key],
      params,
    ),
  }), [effectiveLanguage, koreanPreviewEnabled]);
}

export function LocalizationProvider({ children, controller }: { readonly children: ReactNode; readonly controller: LocalizationController }) {
  return <LocalizationContext.Provider value={controller}>{children}</LocalizationContext.Provider>;
}

export function LocalizationTestProvider({ children, language = "ko" }: { readonly children: ReactNode; readonly language?: DisplayLanguage }) {
  const controller = useMemo<LocalizationController>(() => ({
    effectiveLanguage: language,
    koreanPreviewEnabled: language === "ko",
    setKoreanPreviewEnabled: () => undefined,
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
