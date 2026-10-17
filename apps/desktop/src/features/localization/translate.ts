import type { DisplayLanguage } from "./languagePreference";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS, type TranslationKey } from "./translations";
import { SPANISH_TRANSLATIONS } from "./spanishTranslations";
import { JAPANESE_TRANSLATIONS } from "./locales/ja";
import { BRAZILIAN_PORTUGUESE_TRANSLATIONS } from "./locales/ptBR";
import { SIMPLIFIED_CHINESE_TRANSLATIONS } from "./locales/zhHans";
import { FRENCH_TRANSLATIONS } from "./locales/fr";
import { GERMAN_TRANSLATIONS } from "./locales/de";

export const TRANSLATIONS: Readonly<Record<DisplayLanguage, Readonly<Record<TranslationKey, string>>>> = {
  en: ENGLISH_TRANSLATIONS, ko: KOREAN_TRANSLATIONS, es: SPANISH_TRANSLATIONS,
  ja: JAPANESE_TRANSLATIONS, "pt-BR": BRAZILIAN_PORTUGUESE_TRANSLATIONS,
  "zh-Hans": SIMPLIFIED_CHINESE_TRANSLATIONS, fr: FRENCH_TRANSLATIONS, de: GERMAN_TRANSLATIONS,
};

export type TranslationParams = Readonly<Record<string, string | number>>;
export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

export function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/gu, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

/**
 * A translator for code that runs outside React: event builders that produce
 * user-facing strings in the main window before they cross to a Companion
 * window, and defaults that depend on the current display language.
 */
export function translateFor(language: DisplayLanguage): Translate {
  const table = TRANSLATIONS[language];
  return (key, params) => interpolate(table[key], params);
}
