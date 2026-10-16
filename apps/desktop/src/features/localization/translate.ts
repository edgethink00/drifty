import type { DisplayLanguage } from "./languagePreference";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS, type TranslationKey } from "./translations";
import { SPANISH_TRANSLATIONS } from "./spanishTranslations";

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
  const table = language === "ko" ? KOREAN_TRANSLATIONS : language === "es" ? SPANISH_TRANSLATIONS : ENGLISH_TRANSLATIONS;
  return (key, params) => interpolate(table[key], params);
}
