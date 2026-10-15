import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LocalizationProvider, type LocalizationController } from "./LocalizationContext";
import { DISPLAY_LANGUAGE_STORAGE_KEY, resolveInitialDisplayLanguage } from "./languagePreference";
import { translateFor } from "./translate";
import { parseCategoryNameOverrideKey, withCategoryNameOverrides } from "./categoryNameOverrides";
import { useCategoryNameOverrideKey, useCustomCategoryColorVariables } from "../settings/categoryCustomizationStore";

/** Auxiliary windows follow the main window's preference without writing it back. */
export function AuxiliaryLocalizationProvider({ children }: { readonly children: ReactNode }) {
  const [language, setLanguage] = useState(resolveInitialDisplayLanguage);
  const categoryNameKey = useCategoryNameOverrideKey();
  useCustomCategoryColorVariables();
  useEffect(() => {
    const updateLanguage = (event: StorageEvent) => {
      if (event.key === DISPLAY_LANGUAGE_STORAGE_KEY || event.key === null) {
        setLanguage(resolveInitialDisplayLanguage());
      }
    };
    window.addEventListener("storage", updateLanguage);
    return () => window.removeEventListener("storage", updateLanguage);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.locale = language;
  }, [language]);
  const controller = useMemo<LocalizationController>(() => ({
    effectiveLanguage: language,
    setDisplayLanguage: () => undefined,
    t: withCategoryNameOverrides(translateFor(language), parseCategoryNameOverrideKey(categoryNameKey)),
  }), [categoryNameKey, language]);
  return <LocalizationProvider controller={controller}>{children}</LocalizationProvider>;
}
