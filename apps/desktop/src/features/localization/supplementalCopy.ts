import copy from "./supplementalTranslations.json";
import type { DisplayLanguage } from "./languageCatalog";

export type AdditionalDisplayLanguage = Exclude<DisplayLanguage, "en" | "ko" | "es">;
export function isAdditionalDisplayLanguage(language: DisplayLanguage): language is AdditionalDisplayLanguage {
  return language !== "en" && language !== "ko" && language !== "es";
}

/** Copy shared by native menus, aggregate SVG exports, and legacy inline UI. */
export function supplementalText(language: DisplayLanguage, english: string, params?: Readonly<Record<string, string | number>>): string {
  const table: Readonly<Record<string, string>> | undefined = isAdditionalDisplayLanguage(language) ? copy[language] : undefined;
  const text = table?.[english] ?? english;
  return params ? text.replace(/\{\{(\w+)\}\}/gu, (match, key: string) => params[key] === undefined ? match : String(params[key])) : text;
}
