import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";

export type DisplayLanguage = "en" | "ko" | "es";

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
    const primary = primaryLanguage.trim();
    if (/^ko(?:[-_]|$)/iu.test(primary)) return "ko";
    if (/^es(?:[-_]|$)/iu.test(primary)) return "es";
    return "en";
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
    if (storedLanguage === "en" || storedLanguage === "ko" || storedLanguage === "es") return storedLanguage;

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

/** Upgrade known, deliberate pre-v2 choices without pinning a system-derived default. */
export function migrateLegacyDisplayLanguagePreference(): void {
  if (typeof window === "undefined") return;
  try {
    const storage = window.localStorage;
    const stored = storage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY);
    if (stored !== "en" && stored !== "ko" && stored !== "es") {
      if (storage.getItem(LEGACY_DISPLAY_LANGUAGE_STORAGE_KEY) === "en") {
        storage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
      } else if (
        storage.getItem(LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY) === "1"
        && storage.getItem(DEV_MODE_STORAGE_KEY) === "1"
      ) {
        storage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
      }
    }
    storage.removeItem(LEGACY_KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY);
  } catch {
    // A blocked preference store must not interrupt localization.
  }
}

export function hasExplicitDisplayLanguagePreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY);
    return stored === "en" || stored === "ko" || stored === "es";
  } catch {
    return false;
  }
}
