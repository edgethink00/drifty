export type DisplayLanguage = "en" | "ko";

export const DISPLAY_LANGUAGE_STORAGE_KEY = "drifty.displayLanguage.v2";
export const LEGACY_DISPLAY_LANGUAGE_STORAGE_KEY = "drifty.displayLanguage";
export const LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY = "drifty.dev.koreanLocalizationPreview";

export function resolveInitialDisplayLanguage(): DisplayLanguage {
  if (typeof window === "undefined") return "en";
  try {
    const storedLanguage = window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY);
    if (storedLanguage === "en" || storedLanguage === "ko") return storedLanguage;

    const optedIntoLegacyPreview = window.localStorage.getItem(LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY) === "1"
      && window.localStorage.getItem(LEGACY_DISPLAY_LANGUAGE_STORAGE_KEY) === "ko";
    return optedIntoLegacyPreview ? "ko" : "en";
  } catch {
    return "en";
  }
}
