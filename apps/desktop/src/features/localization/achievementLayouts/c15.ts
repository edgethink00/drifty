/**
 * Strings of layout c15 (layouts/c15). Only the c15 worker edits this file;
 * `en` fixes the keys, each starting with "achievements.c15.", and every
 * other language gives exactly those keys.
 *
 * c15 reuses the shared achievement copy wherever it already says the thing;
 * these are only the words it adds.
 */
import type { LayoutStrings } from "./layoutStrings";

const en = {
  // Read before the held-by-tier line by screen readers only.
  // Quiet labels between the parts of the list.
  "achievements.c15.part.earned": "Earned",
  "achievements.c15.part.notYet": "Not yet",
  // The rarity figure on a row's right edge.
  "achievements.c15.percent": "{{percent}}%",
  // Which time an earned day was. English picks the suffix by plural rule; other languages use "other".
  "achievements.c15.nth.one": "{{count}}st",
  "achievements.c15.nth.two": "{{count}}nd",
  "achievements.c15.nth.few": "{{count}}rd",
  "achievements.c15.nth.other": "{{count}}th",
  "achievements.c15.historyDay": "{{nth}}, {{date}}. Open that day",
  "achievements.c15.earlier": "{{count}} times before these",
  "achievements.c15.earlierOne": "Once before these",
  // Card: which time this was, and the repeat milestone the count has just reached.
  "achievements.c15.nthTime": "{{nth}} time",
  "achievements.c15.milestoneReached": "{{count}}-time milestone reached",
  // Summary style "rare": the label before the rarest achievements held.
  "achievements.c15.summary.rare": "Rare ones",
  // Under the share on a row's right edge: who holds it.
  "achievements.c15.whoHas": "of users",
};

export const C15_STRINGS: LayoutStrings<"c15", typeof en> = {
  en,
  ko: {
    "achievements.c15.part.earned": "얻은 업적",
    "achievements.c15.part.notYet": "아직",
    "achievements.c15.percent": "{{percent}}%",
    "achievements.c15.nth.one": "{{count}}번째",
    "achievements.c15.nth.two": "{{count}}번째",
    "achievements.c15.nth.few": "{{count}}번째",
    "achievements.c15.nth.other": "{{count}}번째",
    "achievements.c15.historyDay": "{{nth}}, {{date}}. 그날 기록 보기",
    "achievements.c15.earlier": "그 전 {{count}}번",
    "achievements.c15.earlierOne": "그 전 1번",
    "achievements.c15.nthTime": "{{nth}}",
    "achievements.c15.milestoneReached": "{{count}}번 이정표 달성",
    "achievements.c15.summary.rare": "드문 업적",
    "achievements.c15.whoHas": "얻은 사람",
  },
  es: {
    "achievements.c15.part.earned": "Conseguidos",
    "achievements.c15.part.notYet": "Aún no",
    "achievements.c15.percent": "{{percent}} %",
    "achievements.c15.nth.one": "{{count}}.ª",
    "achievements.c15.nth.two": "{{count}}.ª",
    "achievements.c15.nth.few": "{{count}}.ª",
    "achievements.c15.nth.other": "{{count}}.ª",
    "achievements.c15.historyDay": "{{nth}}, {{date}}. Abrir ese día",
    "achievements.c15.earlier": "{{count}} veces antes",
    "achievements.c15.earlierOne": "Una vez antes",
    "achievements.c15.nthTime": "{{nth}} vez",
    "achievements.c15.milestoneReached": "Hito de {{count}} veces alcanzado",
    "achievements.c15.summary.rare": "Los más raros",
    "achievements.c15.whoHas": "de usuarios",
  },
  de: {
    "achievements.c15.part.earned": "Erreicht",
    "achievements.c15.part.notYet": "Noch nicht",
    "achievements.c15.percent": "{{percent}} %",
    "achievements.c15.nth.one": "{{count}}.",
    "achievements.c15.nth.two": "{{count}}.",
    "achievements.c15.nth.few": "{{count}}.",
    "achievements.c15.nth.other": "{{count}}.",
    "achievements.c15.historyDay": "{{nth}}, {{date}}. Diesen Tag öffnen",
    "achievements.c15.earlier": "{{count}}-mal davor",
    "achievements.c15.earlierOne": "Einmal davor",
    "achievements.c15.nthTime": "zum {{nth}} Mal",
    "achievements.c15.milestoneReached": "Meilenstein {{count}} erreicht",
    "achievements.c15.summary.rare": "Seltene Erfolge",
    "achievements.c15.whoHas": "der Nutzer",
  },
  fr: {
    "achievements.c15.part.earned": "Obtenus",
    "achievements.c15.part.notYet": "Pas encore",
    "achievements.c15.percent": "{{percent}} %",
    "achievements.c15.nth.one": "{{count}}e",
    "achievements.c15.nth.two": "{{count}}e",
    "achievements.c15.nth.few": "{{count}}e",
    "achievements.c15.nth.other": "{{count}}e",
    "achievements.c15.historyDay": "{{nth}}, {{date}}. Ouvrir ce jour",
    "achievements.c15.earlier": "{{count}} fois avant",
    "achievements.c15.earlierOne": "Une fois avant",
    "achievements.c15.nthTime": "{{nth}} fois",
    "achievements.c15.milestoneReached": "Palier des {{count}} fois atteint",
    "achievements.c15.summary.rare": "Les plus rares",
    "achievements.c15.whoHas": "des utilisateurs",
  },
  ja: {
    "achievements.c15.part.earned": "獲得済み",
    "achievements.c15.part.notYet": "まだ",
    "achievements.c15.percent": "{{percent}}%",
    "achievements.c15.nth.one": "{{count}}回目",
    "achievements.c15.nth.two": "{{count}}回目",
    "achievements.c15.nth.few": "{{count}}回目",
    "achievements.c15.nth.other": "{{count}}回目",
    "achievements.c15.historyDay": "{{nth}}、{{date}}。その日を開く",
    "achievements.c15.earlier": "それ以前 {{count}}回",
    "achievements.c15.earlierOne": "それ以前 1回",
    "achievements.c15.nthTime": "{{nth}}",
    "achievements.c15.milestoneReached": "{{count}}回の節目に到達",
    "achievements.c15.summary.rare": "珍しい実績",
    "achievements.c15.whoHas": "のユーザーが獲得",
  },
  ptBR: {
    "achievements.c15.part.earned": "Conquistadas",
    "achievements.c15.part.notYet": "Ainda não",
    "achievements.c15.percent": "{{percent}}%",
    "achievements.c15.nth.one": "{{count}}ª",
    "achievements.c15.nth.two": "{{count}}ª",
    "achievements.c15.nth.few": "{{count}}ª",
    "achievements.c15.nth.other": "{{count}}ª",
    "achievements.c15.historyDay": "{{nth}}, {{date}}. Abrir esse dia",
    "achievements.c15.earlier": "{{count}} vezes antes",
    "achievements.c15.earlierOne": "Uma vez antes",
    "achievements.c15.nthTime": "{{nth}} vez",
    "achievements.c15.milestoneReached": "Marco de {{count}} vezes alcançado",
    "achievements.c15.summary.rare": "Os mais raros",
    "achievements.c15.whoHas": "dos usuários",
  },
  zhHans: {
    "achievements.c15.part.earned": "已获得",
    "achievements.c15.part.notYet": "尚未获得",
    "achievements.c15.percent": "{{percent}}%",
    "achievements.c15.nth.one": "第 {{count}} 次",
    "achievements.c15.nth.two": "第 {{count}} 次",
    "achievements.c15.nth.few": "第 {{count}} 次",
    "achievements.c15.nth.other": "第 {{count}} 次",
    "achievements.c15.historyDay": "{{nth}}，{{date}}。打开那一天",
    "achievements.c15.earlier": "此前还有 {{count}} 次",
    "achievements.c15.earlierOne": "此前还有 1 次",
    "achievements.c15.nthTime": "{{nth}}",
    "achievements.c15.milestoneReached": "达成 {{count}} 次里程碑",
    "achievements.c15.summary.rare": "稀有成就",
    "achievements.c15.whoHas": "的用户获得",
  },
};
