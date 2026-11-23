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
 *
 * c1 reuses the shared achievement copy wherever it already says the thing;
 * these are only the words it adds.
 */
import type { LayoutStrings } from "./layoutStrings";

const en = {
  // A tile's status line for an achievement with nothing to show yet.
  "achievements.c1.notYet": "Not yet",
  // Under the record row of a repeated achievement: its first and latest day.
  "achievements.c1.span": "First {{first}} · latest {{last}}",
};

export const C1_STRINGS: LayoutStrings<"c1", typeof en> = {
  en,
  ko: {
    "achievements.c1.notYet": "아직",
    "achievements.c1.span": "처음 {{first}} · 마지막 {{last}}",
  },
  es: {
    "achievements.c1.notYet": "Aún no",
    "achievements.c1.span": "Primera vez: {{first}} · última: {{last}}",
  },
  de: {
    "achievements.c1.notYet": "Noch nicht",
    "achievements.c1.span": "Erstmals {{first}} · zuletzt {{last}}",
  },
  fr: {
    "achievements.c1.notYet": "Pas encore",
    "achievements.c1.span": "Première fois le {{first}} · dernière le {{last}}",
  },
  ja: {
    "achievements.c1.notYet": "まだ",
    "achievements.c1.span": "初回 {{first}} · 最新 {{last}}",
  },
  ptBR: {
    "achievements.c1.notYet": "Ainda não",
    "achievements.c1.span": "Primeira vez: {{first}} · última: {{last}}",
  },
  zhHans: {
    "achievements.c1.notYet": "尚未获得",
    "achievements.c1.span": "首次 {{first}} · 最近 {{last}}",
  },
};
