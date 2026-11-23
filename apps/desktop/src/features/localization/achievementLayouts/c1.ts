/**
 * Strings of layout c1 (layouts/c1). Only the c1 worker edits this file;
 * c2.ts to c6.ts have the same shape.
 *
 * Shape: `en` lists every key, each starting with "achievements.c1.", for
 * example "achievements.c1.title": "Your medals". Every other language
 * object (ko, es, de, fr, ja, ptBR, zhHans) must give exactly the same keys:
 * typecheck fails when one misses a key or adds one. achievementTranslations.ts
 * already spreads this file into all eight languages, so the keys are valid
 * TranslationKeys: call t("achievements.c1.title").
 */
import type { LayoutStrings } from "./layoutStrings";

const en = {};

export const C1_STRINGS: LayoutStrings<"c1", typeof en> = {
  en,
  ko: {},
  es: {},
  de: {},
  fr: {},
  ja: {},
  ptBR: {},
  zhHans: {},
};
