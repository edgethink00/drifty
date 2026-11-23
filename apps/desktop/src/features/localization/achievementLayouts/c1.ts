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
  // Side panel: heading over the closest open achievement in the chosen one's group,
  // and the line shown instead when every achievement of that group is earned.
  "achievements.c1.nextInGroup": "Next in {{group}}",
  "achievements.c1.groupDone": "Every achievement in this group is yours",
  // Side panel stat: its label and the share of people as a percent ({{value}} is the formatted number).
  "achievements.c1.holders": "People who have it",
  "achievements.c1.percent": "{{value}}%",
};

export const C1_STRINGS: LayoutStrings<"c1", typeof en> = {
  en,
  ko: {
    "achievements.c1.notYet": "아직",
    "achievements.c1.span": "처음 {{first}} · 마지막 {{last}}",
    "achievements.c1.nextInGroup": "{{group}}의 다음 업적",
    "achievements.c1.groupDone": "이 묶음의 업적을 모두 모았어요",
    "achievements.c1.holders": "이 업적을 얻은 사람",
    "achievements.c1.percent": "{{value}}%",
  },
  es: {
    "achievements.c1.notYet": "Aún no",
    "achievements.c1.span": "Primera vez: {{first}} · última: {{last}}",
    "achievements.c1.nextInGroup": "Lo siguiente en {{group}}",
    "achievements.c1.groupDone": "Ya tienes todos los logros de este grupo",
    "achievements.c1.holders": "Personas que lo tienen",
    "achievements.c1.percent": "{{value}} %",
  },
  de: {
    "achievements.c1.notYet": "Noch nicht",
    "achievements.c1.span": "Erstmals {{first}} · zuletzt {{last}}",
    "achievements.c1.nextInGroup": "Als Nächstes in {{group}}",
    "achievements.c1.groupDone": "Alle Erfolge dieser Gruppe gehören dir",
    "achievements.c1.holders": "Personen mit diesem Erfolg",
    "achievements.c1.percent": "{{value}} %",
  },
  fr: {
    "achievements.c1.notYet": "Pas encore",
    "achievements.c1.span": "Première fois le {{first}} · dernière le {{last}}",
    "achievements.c1.nextInGroup": "Prochain dans {{group}}",
    "achievements.c1.groupDone": "Tous les succès de ce groupe sont à vous",
    "achievements.c1.holders": "Personnes qui l’ont",
    "achievements.c1.percent": "{{value}} %",
  },
  ja: {
    "achievements.c1.notYet": "まだ",
    "achievements.c1.span": "初回 {{first}} · 最新 {{last}}",
    "achievements.c1.nextInGroup": "{{group}}の次の実績",
    "achievements.c1.groupDone": "このグループの実績はすべて獲得済みです",
    "achievements.c1.holders": "獲得した人",
    "achievements.c1.percent": "{{value}}%",
  },
  ptBR: {
    "achievements.c1.notYet": "Ainda não",
    "achievements.c1.span": "Primeira vez: {{first}} · última: {{last}}",
    "achievements.c1.nextInGroup": "Próximo em {{group}}",
    "achievements.c1.groupDone": "Você já tem todas as conquistas deste grupo",
    "achievements.c1.holders": "Pessoas que têm",
    "achievements.c1.percent": "{{value}}%",
  },
  zhHans: {
    "achievements.c1.notYet": "尚未获得",
    "achievements.c1.span": "首次 {{first}} · 最近 {{last}}",
    "achievements.c1.nextInGroup": "{{group}}的下一个成就",
    "achievements.c1.groupDone": "这一组的成就已全部获得",
    "achievements.c1.holders": "获得的人",
    "achievements.c1.percent": "{{value}}%",
  },
};
