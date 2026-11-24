/**
 * Strings of layout c16 (layouts/c16). Only the c16 worker edits this file;
 * `en` fixes the keys, each starting with "achievements.c16.", and every
 * other language gives exactly those keys.
 *
 * c16 reuses the shared achievement copy wherever it already says the thing;
 * these are only the words it adds.
 */
import type { LayoutStrings } from "./layoutStrings";

const en = {
  // Read before the held tiers (or medal metals) in the summary line, by screen readers only.
  // Quiet labels between the parts of the list ("Almost there" is shared).
  "achievements.c16.earned": "Earned",
  "achievements.c16.notYet": "Not yet",
  // Accessible name of a date in an opened row's record.
  "achievements.c16.historyDay": "{{date}}, open that day",
  // Times earned before the kept days begin, after the last date.
  "achievements.c16.earlier": "{{count}} times before that",
  "achievements.c16.earlierOne": "once before that",
};

export const C16_STRINGS: LayoutStrings<"c16", typeof en> = {
  en,
  ko: {
    "achievements.c16.earned": "얻은 업적",
    "achievements.c16.notYet": "아직",
    "achievements.c16.historyDay": "{{date}}, 그날 기록 보기",
    "achievements.c16.earlier": "그 전 {{count}}번",
    "achievements.c16.earlierOne": "그 전 1번",
  },
  es: {
    "achievements.c16.earned": "Conseguidos",
    "achievements.c16.notYet": "Aún no",
    "achievements.c16.historyDay": "{{date}}, abrir ese día",
    "achievements.c16.earlier": "{{count}} veces antes",
    "achievements.c16.earlierOne": "una vez antes",
  },
  de: {
    "achievements.c16.earned": "Erreicht",
    "achievements.c16.notYet": "Noch nicht",
    "achievements.c16.historyDay": "{{date}}, diesen Tag öffnen",
    "achievements.c16.earlier": "{{count}}-mal davor",
    "achievements.c16.earlierOne": "einmal davor",
  },
  fr: {
    "achievements.c16.earned": "Obtenus",
    "achievements.c16.notYet": "Pas encore",
    "achievements.c16.historyDay": "{{date}}, ouvrir ce jour",
    "achievements.c16.earlier": "{{count}} fois avant",
    "achievements.c16.earlierOne": "une fois avant",
  },
  ja: {
    "achievements.c16.earned": "獲得済み",
    "achievements.c16.notYet": "まだ",
    "achievements.c16.historyDay": "{{date}}、その日を開く",
    "achievements.c16.earlier": "それ以前に{{count}}回",
    "achievements.c16.earlierOne": "それ以前に1回",
  },
  ptBR: {
    "achievements.c16.earned": "Conquistadas",
    "achievements.c16.notYet": "Ainda não",
    "achievements.c16.historyDay": "{{date}}, abrir esse dia",
    "achievements.c16.earlier": "{{count}} vezes antes",
    "achievements.c16.earlierOne": "uma vez antes",
  },
  zhHans: {
    "achievements.c16.earned": "已获得",
    "achievements.c16.notYet": "尚未获得",
    "achievements.c16.historyDay": "{{date}}，打开那一天",
    "achievements.c16.earlier": "此前还有 {{count}} 次",
    "achievements.c16.earlierOne": "此前还有 1 次",
  },
};
