import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TranslationKey } from "./translations";
import { translateFor, type TranslationParams } from "./translate";
import { parseCategoryNameOverrideKey, withCategoryNameOverrides } from "./categoryNameOverrides";
import { useCategoryNameOverrideKey, useCustomCategoryColorVariables, useProductivityLevelStyles } from "../settings/categoryCustomizationStore";
import {
  DISPLAY_LANGUAGE_STORAGE_KEY,
  LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY,
  hasExplicitDisplayLanguagePreference,
  migrateLegacyDisplayLanguagePreference,
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
  const [effectiveLanguage, setEffectiveLanguage] = useState<DisplayLanguage>(resolveInitialDisplayLanguage);

  const setDisplayLanguage = useCallback((language: DisplayLanguage) => {
    try {
      window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, language);
      window.localStorage.removeItem(LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY);
    } catch {
      // Keep the user's live choice even when preference storage is unavailable.
    }
    setEffectiveLanguage(language);
  }, []);
  const categoryNameKey = useCategoryNameOverrideKey();
  useCustomCategoryColorVariables();
  useProductivityLevelStyles();

  useEffect(() => {
    migrateLegacyDisplayLanguagePreference();
    const followSystemLanguage = () => {
      if (!hasExplicitDisplayLanguagePreference()) {
        setEffectiveLanguage(resolveSystemDisplayLanguage(window.navigator));
      }
    };
    window.addEventListener("languagechange", followSystemLanguage);
    return () => window.removeEventListener("languagechange", followSystemLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = effectiveLanguage;
    document.documentElement.dataset.locale = effectiveLanguage;
  }, [effectiveLanguage]);

  return useMemo(() => ({
    effectiveLanguage,
    setDisplayLanguage,
    t: withCategoryNameOverrides(translateFor(effectiveLanguage), parseCategoryNameOverrideKey(categoryNameKey)),
  }), [categoryNameKey, effectiveLanguage, setDisplayLanguage]);
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
