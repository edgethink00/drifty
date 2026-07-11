import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS, type TranslationKey } from "./translations";
import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";

export type DisplayLanguage = "en" | "ko";

export const KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY = "drifty.dev.koreanLocalizationPreview";
export const DISPLAY_LANGUAGE_STORAGE_KEY = "drifty.displayLanguage";

type TranslationParams = Readonly<Record<string, string | number>>;

export type LocalizationController = {
  readonly displayLanguage: DisplayLanguage;
  readonly effectiveLanguage: DisplayLanguage;
  readonly koreanPreviewEnabled: boolean;
  readonly setDisplayLanguage: (language: DisplayLanguage) => void;
  readonly setKoreanPreviewEnabled: (enabled: boolean) => void;
  readonly t: (key: TranslationKey, params?: TranslationParams) => string;
};

const englishController: LocalizationController = {
  displayLanguage: "en",
  effectiveLanguage: "en",
  koreanPreviewEnabled: false,
  setDisplayLanguage: () => undefined,
  setKoreanPreviewEnabled: () => undefined,
  t: (key, params) => interpolate(ENGLISH_TRANSLATIONS[key], params),
};

const LocalizationContext = createContext<LocalizationController>(englishController);

export function useLocalization(): LocalizationController {
  return useContext(LocalizationContext);
}

export function useLocalizationController(): LocalizationController {
  const [koreanPreviewEnabled, setKoreanPreviewEnabled] = useState(resolveInitialKoreanPreviewEnabled);
  const [displayLanguage, setDisplayLanguage] = useState<DisplayLanguage>(resolveInitialDisplayLanguage);
  const effectiveLanguage: DisplayLanguage = koreanPreviewEnabled && displayLanguage === "ko" ? "ko" : "en";

  useEffect(() => {
    window.localStorage.setItem(KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY, koreanPreviewEnabled ? "1" : "0");
  }, [koreanPreviewEnabled]);

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
    koreanPreviewEnabled,
    setDisplayLanguage,
    setKoreanPreviewEnabled,
    t: (key: TranslationKey, params?: TranslationParams) => interpolate(
      effectiveLanguage === "ko" ? KOREAN_TRANSLATIONS[key] : ENGLISH_TRANSLATIONS[key],
      params,
    ),
  }), [displayLanguage, effectiveLanguage, koreanPreviewEnabled]);
}

export function LocalizationProvider({ children, controller }: { readonly children: ReactNode; readonly controller: LocalizationController }) {
  return <LocalizationContext.Provider value={controller}>{children}</LocalizationContext.Provider>;
}

export function LocalizationTestProvider({ children, language = "ko" }: { readonly children: ReactNode; readonly language?: DisplayLanguage }) {
  const controller = useMemo<LocalizationController>(() => ({
    displayLanguage: language,
    effectiveLanguage: language,
    koreanPreviewEnabled: language === "ko",
    setDisplayLanguage: () => undefined,
    setKoreanPreviewEnabled: () => undefined,
    t: (key, params) => interpolate(language === "ko" ? KOREAN_TRANSLATIONS[key] : ENGLISH_TRANSLATIONS[key], params),
  }), [language]);
  return <LocalizationContext.Provider value={controller}>{children}</LocalizationContext.Provider>;
}

export function resolveInitialKoreanPreviewEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY) === "1"
      && window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function resolveInitialDisplayLanguage(): DisplayLanguage {
  if (typeof window === "undefined") return "ko";
  try {
    return window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY) === "en" ? "en" : "ko";
  } catch {
    return "ko";
  }
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/gu, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
