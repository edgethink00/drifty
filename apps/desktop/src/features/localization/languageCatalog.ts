import type { TranslationKey } from "./translations";

/** One list owns language tags, native labels, and default formatting locales. */
export const DISPLAY_LANGUAGES = [
  { value: "en", label: "English", locale: "en-US", labelKey: "settings.general.languageEnglish" },
  { value: "ko", label: "한국어", locale: "ko-KR", labelKey: "settings.general.languageKorean" },
  { value: "es", label: "Español", locale: "es", labelKey: "settings.general.languageSpanish" },
  { value: "ja", label: "日本語", locale: "ja-JP" },
  { value: "pt-BR", label: "Português (Brasil)", locale: "pt-BR" },
  { value: "zh-Hans", label: "简体中文", locale: "zh-Hans-CN" },
  { value: "fr", label: "Français", locale: "fr-FR" },
  { value: "de", label: "Deutsch", locale: "de-DE" },
] as const;

export type DisplayLanguage = typeof DISPLAY_LANGUAGES[number]["value"];

export function isDisplayLanguage(value: unknown): value is DisplayLanguage {
  return typeof value === "string" && DISPLAY_LANGUAGES.some((entry) => entry.value === value);
}

export function languageDisplayName(language: DisplayLanguage, t?: (key: TranslationKey) => string): string {
  const entry = DISPLAY_LANGUAGES.find((item) => item.value === language)!;
  return t && "labelKey" in entry ? t(entry.labelKey) : entry.label;
}

/** Resolve only the first preferred language; do not select a lower-ranked one. */
export function displayLanguageForTag(tag: string): DisplayLanguage | null {
  const normalized = tag.trim().replace(/_/gu, "-");
  try {
    const locale = new Intl.Locale(normalized);
    switch (locale.language) {
      case "en": case "ko": case "es": case "ja": case "fr": case "de": return locale.language;
      case "pt": return "pt-BR";
      // Traditional Chinese is a distinct translation, not a regional alias.
      case "zh": return locale.maximize().script === "Hans" ? "zh-Hans" : null;
      default: return null;
    }
  } catch { return null; }
}

export function defaultLocaleForLanguage(language: DisplayLanguage): string {
  return DISPLAY_LANGUAGES.find((entry) => entry.value === language)!.locale;
}
