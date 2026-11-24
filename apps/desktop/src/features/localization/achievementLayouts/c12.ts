/**
 * Strings of layout c12 (layouts/c12). Only the c12 worker edits this file;
 * `en` fixes the keys, each starting with "achievements.c12.", and every
 * other language gives exactly those keys.
 *
 * c12 reuses the shared achievement copy wherever it already says the thing;
 * these are only the words it adds.
 */
import type { LayoutStrings } from "./layoutStrings";

const en = {
  // Summary line: how many are held, before the held-by-tier line.
  // Read before the held-by-tier line by screen readers only.
  // Quiet labels over the list's parts (the first part reuses "Almost there").
  "achievements.c12.earnedTitle": "Earned",
  "achievements.c12.notYetTitle": "Not yet",
  // Which time an earned day was. English picks the suffix by plural rule; other languages use "other".
  "achievements.c12.nth.one": "{{count}}st",
  "achievements.c12.nth.two": "{{count}}nd",
  "achievements.c12.nth.few": "{{count}}rd",
  "achievements.c12.nth.other": "{{count}}th",
  // Opened row: facts and history.
  "achievements.c12.firstDay": "First earned",
  "achievements.c12.topic": "Topic",
  "achievements.c12.historyDay": "{{nth}}, {{date}}. Open that day",
  "achievements.c12.earlier": "{{count}} times before that",
  "achievements.c12.earlierOne": "Once before that",
};

export const C12_STRINGS: LayoutStrings<"c12", typeof en> = {
  en,
  ko: {
    "achievements.c12.earnedTitle": "얻은 업적",
    "achievements.c12.notYetTitle": "아직 얻지 못한 업적",
    "achievements.c12.nth.one": "{{count}}번째",
    "achievements.c12.nth.two": "{{count}}번째",
    "achievements.c12.nth.few": "{{count}}번째",
    "achievements.c12.nth.other": "{{count}}번째",
    "achievements.c12.firstDay": "처음 얻은 날",
    "achievements.c12.topic": "주제",
    "achievements.c12.historyDay": "{{nth}}, {{date}}. 그날 기록 보기",
    "achievements.c12.earlier": "그 전 {{count}}번",
    "achievements.c12.earlierOne": "그 전 1번",
  },
  es: {
    "achievements.c12.earnedTitle": "Conseguidos",
    "achievements.c12.notYetTitle": "Aún no",
    "achievements.c12.nth.one": "{{count}}.ª",
    "achievements.c12.nth.two": "{{count}}.ª",
    "achievements.c12.nth.few": "{{count}}.ª",
    "achievements.c12.nth.other": "{{count}}.ª",
    "achievements.c12.firstDay": "Primera vez",
    "achievements.c12.topic": "Tema",
    "achievements.c12.historyDay": "{{nth}}, {{date}}. Abrir ese día",
    "achievements.c12.earlier": "{{count}} veces antes",
    "achievements.c12.earlierOne": "Una vez antes",
  },
  de: {
    "achievements.c12.earnedTitle": "Erreicht",
    "achievements.c12.notYetTitle": "Noch nicht",
    "achievements.c12.nth.one": "{{count}}.",
    "achievements.c12.nth.two": "{{count}}.",
    "achievements.c12.nth.few": "{{count}}.",
    "achievements.c12.nth.other": "{{count}}.",
    "achievements.c12.firstDay": "Erstmals",
    "achievements.c12.topic": "Thema",
    "achievements.c12.historyDay": "{{nth}}, {{date}}. Diesen Tag öffnen",
    "achievements.c12.earlier": "{{count}}-mal davor",
    "achievements.c12.earlierOne": "Einmal davor",
  },
  fr: {
    "achievements.c12.earnedTitle": "Obtenus",
    "achievements.c12.notYetTitle": "Pas encore",
    "achievements.c12.nth.one": "{{count}}e",
    "achievements.c12.nth.two": "{{count}}e",
    "achievements.c12.nth.few": "{{count}}e",
    "achievements.c12.nth.other": "{{count}}e",
    "achievements.c12.firstDay": "Première fois",
    "achievements.c12.topic": "Thème",
    "achievements.c12.historyDay": "{{nth}}, {{date}}. Ouvrir ce jour",
    "achievements.c12.earlier": "{{count}} fois avant",
    "achievements.c12.earlierOne": "Une fois avant",
  },
  ja: {
    "achievements.c12.earnedTitle": "達成済み",
    "achievements.c12.notYetTitle": "未達成",
    "achievements.c12.nth.one": "{{count}}回目",
    "achievements.c12.nth.two": "{{count}}回目",
    "achievements.c12.nth.few": "{{count}}回目",
    "achievements.c12.nth.other": "{{count}}回目",
    "achievements.c12.firstDay": "初めて達成",
    "achievements.c12.topic": "テーマ",
    "achievements.c12.historyDay": "{{nth}}、{{date}}。その日を開く",
    "achievements.c12.earlier": "それ以前 {{count}}回",
    "achievements.c12.earlierOne": "それ以前 1回",
  },
  ptBR: {
    "achievements.c12.earnedTitle": "Conquistadas",
    "achievements.c12.notYetTitle": "Ainda não",
    "achievements.c12.nth.one": "{{count}}ª",
    "achievements.c12.nth.two": "{{count}}ª",
    "achievements.c12.nth.few": "{{count}}ª",
    "achievements.c12.nth.other": "{{count}}ª",
    "achievements.c12.firstDay": "Primeira vez",
    "achievements.c12.topic": "Tema",
    "achievements.c12.historyDay": "{{nth}}, {{date}}. Abrir esse dia",
    "achievements.c12.earlier": "{{count}} vezes antes",
    "achievements.c12.earlierOne": "Uma vez antes",
  },
  zhHans: {
    "achievements.c12.earnedTitle": "已获得",
    "achievements.c12.notYetTitle": "尚未获得",
    "achievements.c12.nth.one": "第 {{count}} 次",
    "achievements.c12.nth.two": "第 {{count}} 次",
    "achievements.c12.nth.few": "第 {{count}} 次",
    "achievements.c12.nth.other": "第 {{count}} 次",
    "achievements.c12.firstDay": "首次获得",
    "achievements.c12.topic": "主题",
    "achievements.c12.historyDay": "{{nth}}，{{date}}。打开那一天",
    "achievements.c12.earlier": "此前 {{count}} 次",
    "achievements.c12.earlierOne": "此前 1 次",
  },
};
