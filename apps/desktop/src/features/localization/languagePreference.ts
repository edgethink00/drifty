import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";

export type DisplayLanguage = "en" | "ko";

// The unversioned key was once populated with "ko" even while the UI was English.
// Keep using the safe namespace introduced by the original public-beta migration.
export const DISPLAY_LANGUAGE_STORAGE_KEY = "drifty.displayLanguage.v2";
export const LEGACY_DISPLAY_LANGUAGE_STORAGE_KEY = "drifty.displayLanguage";
export const LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY = "drifty.dev.koreanLocalizationPreview";

type SystemLanguagePreferences = {
  readonly language?: string | null;
  readonly languages?: readonly string[] | null;
};

export function resolveSystemDisplayLanguage(preferences: SystemLanguagePreferences): DisplayLanguage {
  try {
    const primaryLanguage = preferences.languages?.[0] || preferences.language || "";
    return /^ko(?:[-_]|$)/iu.test(primaryLanguage.trim()) ? "ko" : "en";
  } catch {
    return "en";
  }
}

export function resolveInitialDisplayLanguage(
  systemPreferences?: SystemLanguagePreferences,
): DisplayLanguage {
  if (typeof window === "undefined") return "en";
  try {
    const storedLanguage = window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY);
    if (storedLanguage === "en" || storedLanguage === "ko") return storedLanguage;

    // English was never the implicit Korean-preview default and is safe to retain.
    // Unversioned "ko" has no provenance: fall back to the system unless opted in.
    if (window.localStorage.getItem(LEGACY_DISPLAY_LANGUAGE_STORAGE_KEY) === "en") return "en";

    const legacyKoreanPreviewEnabled = window.localStorage.getItem(LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY) === "1"
      && window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1";
    if (legacyKoreanPreviewEnabled) return "ko";
  } catch {
    // A blocked preference store should not prevent a useful system-language default.
  }

  return resolveSystemDisplayLanguage(systemPreferences ?? window.navigator);
}
