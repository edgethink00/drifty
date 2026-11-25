/** Every display language other than English; a layout's strings file gives each of them. */
export type LayoutStringLanguage = "ko" | "es" | "de" | "fr" | "ja" | "ptBR" | "zhHans";

/**
 * One layout's strings in all eight languages. `En` (the English object)
 * fixes the keys: each must start with "achievements.<id>.", and every other
 * language must give exactly those keys, so a missing or extra key fails
 * typecheck. A key outside the layout's namespace turns the type into never.
 */
export type LayoutStrings<Id extends string, En extends Readonly<Record<string, string>>> =
  [keyof En] extends [`achievements.${Id}.${string}`]
    ? { readonly en: En } & { readonly [Language in LayoutStringLanguage]: Readonly<Record<keyof En, string>> }
    : never;
