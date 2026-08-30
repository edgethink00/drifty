import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";

export type DisplayLanguage = "en" | "ko";

export const KOREAN_LOCALIZATION_PREVIEW_STORAGE_KEY = "drifty.dev.koreanLocalizationPreview";

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
  return resolveInitialKoreanPreviewEnabled() ? "ko" : "en";
}
