/**
 * Strings of layout c9 (layouts/c9): the achievements as a list view with
 * columns, each row opening its record underneath. Only the c9 worker edits
 * this file; same shape as c1.ts: `en` fixes the keys, each starting with
 * "achievements.c9.", and every other language gives exactly those keys.
 *
 * c9 reuses the shared achievement copy wherever it already says the thing;
 * these are only the words it adds.
 */
import type { LayoutStrings } from "./layoutStrings";

const en = {
  // Column labels over the list.
  "achievements.c9.col.name": "Achievement",
  "achievements.c9.col.condition": "Condition",
  "achievements.c9.col.rarity": "Rarity",
  "achievements.c9.col.times": "Times",
  "achievements.c9.col.last": "Latest",
  // How many times an earned repeatable achievement has been reached, in the times column.
  "achievements.c9.times": "×{{count}}",
  // Which time a day was: the 40th, shown on a history chip and in the card's times column.
  "achievements.c9.nth": "#{{count}}",
  // Accessible name of a history chip: which time, the date, and what pressing it does.
  "achievements.c9.dayLabel": "{{nth}}, {{date}}. Open that day",
  // The times earned before the kept days begin, folded into one count.
  "achievements.c9.earlier": "{{count}} earlier",
  "achievements.c9.showAll": "Show all {{count}}",
  "achievements.c9.showLess": "Show fewer",
  "achievements.c9.firstDay": "First earned",
  // Accessible name of an almost-there row: the achievement and what is left.
  "achievements.c9.nearLabel": "{{name}}, {{left}}",
  // A locked row with nothing under way yet.
  "achievements.c9.notYet": "Not yet",
  // One entry of the held-by-tier line: a tier or medal name and how many are held.
  "achievements.c9.tierCount": "{{name}} {{count}}",
};

export const C9_STRINGS: LayoutStrings<"c9", typeof en> = {
  en,
  ko: {
    "achievements.c9.col.name": "업적",
    "achievements.c9.col.condition": "조건",
    "achievements.c9.col.rarity": "희귀도",
    "achievements.c9.col.times": "횟수",
    "achievements.c9.col.last": "마지막",
    "achievements.c9.times": "×{{count}}",
    "achievements.c9.nth": "{{count}}번째",
    "achievements.c9.dayLabel": "{{nth}}, {{date}}. 그날 기록 보기",
    "achievements.c9.earlier": "그 전 {{count}}번",
    "achievements.c9.showAll": "모두 보기 ({{count}})",
    "achievements.c9.showLess": "접기",
    "achievements.c9.firstDay": "처음 얻은 날",
    "achievements.c9.nearLabel": "{{name}}, {{left}}",
    "achievements.c9.notYet": "아직",
    "achievements.c9.tierCount": "{{name}} {{count}}",
  },
  es: {
    "achievements.c9.col.name": "Logro",
    "achievements.c9.col.condition": "Condición",
    "achievements.c9.col.rarity": "Rareza",
    "achievements.c9.col.times": "Veces",
    "achievements.c9.col.last": "Última",
    "achievements.c9.times": "×{{count}}",
    "achievements.c9.nth": "{{count}}.ª",
    "achievements.c9.dayLabel": "{{nth}} vez, {{date}}. Abrir ese día",
    "achievements.c9.earlier": "{{count}} anteriores",
    "achievements.c9.showAll": "Ver las {{count}}",
    "achievements.c9.showLess": "Ver menos",
    "achievements.c9.firstDay": "Primera vez",
    "achievements.c9.nearLabel": "{{name}}, {{left}}",
    "achievements.c9.notYet": "Aún no",
    "achievements.c9.tierCount": "{{name}} {{count}}",
  },
  de: {
    "achievements.c9.col.name": "Erfolg",
    "achievements.c9.col.condition": "Bedingung",
    "achievements.c9.col.rarity": "Seltenheit",
    "achievements.c9.col.times": "Anzahl",
    "achievements.c9.col.last": "Zuletzt",
    "achievements.c9.times": "×{{count}}",
    "achievements.c9.nth": "{{count}}.",
    "achievements.c9.dayLabel": "{{nth}} Mal, {{date}}. Diesen Tag öffnen",
    "achievements.c9.earlier": "{{count}}× davor",
    "achievements.c9.showAll": "Alle {{count}} zeigen",
    "achievements.c9.showLess": "Weniger zeigen",
    "achievements.c9.firstDay": "Zuerst erreicht",
    "achievements.c9.nearLabel": "{{name}}, {{left}}",
    "achievements.c9.notYet": "Noch nicht",
    "achievements.c9.tierCount": "{{name}} {{count}}",
  },
  fr: {
    "achievements.c9.col.name": "Succès",
    "achievements.c9.col.condition": "Condition",
    "achievements.c9.col.rarity": "Rareté",
    "achievements.c9.col.times": "Fois",
    "achievements.c9.col.last": "Dernière",
    "achievements.c9.times": "×{{count}}",
    "achievements.c9.nth": "{{count}}e",
    "achievements.c9.dayLabel": "{{nth}} fois, {{date}}. Ouvrir ce jour",
    "achievements.c9.earlier": "{{count}} fois avant",
    "achievements.c9.showAll": "Tout afficher ({{count}})",
    "achievements.c9.showLess": "Afficher moins",
    "achievements.c9.firstDay": "Première fois",
    "achievements.c9.nearLabel": "{{name}}, {{left}}",
    "achievements.c9.notYet": "Pas encore",
    "achievements.c9.tierCount": "{{name}} {{count}}",
  },
  ja: {
    "achievements.c9.col.name": "実績",
    "achievements.c9.col.condition": "条件",
    "achievements.c9.col.rarity": "レア度",
    "achievements.c9.col.times": "回数",
    "achievements.c9.col.last": "最新",
    "achievements.c9.times": "×{{count}}",
    "achievements.c9.nth": "{{count}}回目",
    "achievements.c9.dayLabel": "{{nth}}、{{date}}。その日を開く",
    "achievements.c9.earlier": "それ以前 {{count}}回",
    "achievements.c9.showAll": "すべて表示（{{count}}）",
    "achievements.c9.showLess": "折りたたむ",
    "achievements.c9.firstDay": "初めて獲得",
    "achievements.c9.nearLabel": "{{name}}、{{left}}",
    "achievements.c9.notYet": "まだ",
    "achievements.c9.tierCount": "{{name}} {{count}}",
  },
  ptBR: {
    "achievements.c9.col.name": "Conquista",
    "achievements.c9.col.condition": "Condição",
    "achievements.c9.col.rarity": "Raridade",
    "achievements.c9.col.times": "Vezes",
    "achievements.c9.col.last": "Última",
    "achievements.c9.times": "×{{count}}",
    "achievements.c9.nth": "{{count}}ª",
    "achievements.c9.dayLabel": "{{nth}} vez, {{date}}. Abrir esse dia",
    "achievements.c9.earlier": "{{count}} antes",
    "achievements.c9.showAll": "Ver todas ({{count}})",
    "achievements.c9.showLess": "Ver menos",
    "achievements.c9.firstDay": "Primeira vez",
    "achievements.c9.nearLabel": "{{name}}, {{left}}",
    "achievements.c9.notYet": "Ainda não",
    "achievements.c9.tierCount": "{{name}} {{count}}",
  },
  zhHans: {
    "achievements.c9.col.name": "成就",
    "achievements.c9.col.condition": "条件",
    "achievements.c9.col.rarity": "稀有度",
    "achievements.c9.col.times": "次数",
    "achievements.c9.col.last": "最近",
    "achievements.c9.times": "×{{count}}",
    "achievements.c9.nth": "第{{count}}次",
    "achievements.c9.dayLabel": "{{nth}}，{{date}}。打开那一天",
    "achievements.c9.earlier": "此前 {{count}} 次",
    "achievements.c9.showAll": "全部显示（{{count}}）",
    "achievements.c9.showLess": "收起",
    "achievements.c9.firstDay": "首次获得",
    "achievements.c9.nearLabel": "{{name}}，{{left}}",
    "achievements.c9.notYet": "尚未",
    "achievements.c9.tierCount": "{{name}} {{count}}",
  },
};
