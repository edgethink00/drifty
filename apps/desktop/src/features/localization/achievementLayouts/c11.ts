/**
 * Strings of layout c11 (layouts/c11). Only the c11 worker edits this file;
 * same shape as c1.ts: `en` fixes the keys, each starting with "achievements.c11.",
 * and every other language gives exactly those keys.
 *
 * c11 reuses the shared achievement copy wherever it already says the thing;
 * these are only the words it adds.
 */
import type { LayoutStrings } from "./layoutStrings";

const en = {
  // Stage fact row: the day the achievement was first reached.
  "achievements.c11.firstEarned": "First earned",
  // One entry of the history timeline: which time it was. {{ordinal}} is "40th" (English only); other languages use {{count}}.
  "achievements.c11.nth": "{{ordinal}} time",
  // The very first time, in the timeline and on the card.
  "achievements.c11.firstTime": "First time",
  // Bottom of the timeline: times earned before the days this computer still keeps.
  "achievements.c11.earlier": "{{count}} times before these",
  "achievements.c11.earlierOne": "Once before these",
  // Locked achievement with no progress yet, in the stage's history zone.
  "achievements.c11.notStarted": "Not started yet",
  // Under a locked achievement's progress: what the history zone will hold.
  "achievements.c11.historyEmpty": "Each day you earn it will be listed here.",
  // Accessible name of an almost-there entry: name and what is left.
  "achievements.c11.nearLabel": "{{name}}, {{left}}",
  // Almost-there column when nothing is left to chase.
  "achievements.c11.nearDone": "Every medal is at its highest",
  // Card: the closest goal after this one, as a quiet line.
  "achievements.c11.nextGoal": "Next up: {{name}}, {{left}}",
  // Under a short history of a repeatable one: the next metal its medal is working toward.
  "achievements.c11.nextMedal": "Next medal",
  // Under a short history of a one-off: the closest unearned achievement in the same group.
  "achievements.c11.groupNext": "Next in {{group}}",
};

export const C11_STRINGS: LayoutStrings<"c11", typeof en> = {
  en,
  ko: {
    "achievements.c11.firstEarned": "처음 얻은 날",
    "achievements.c11.nth": "{{count}}번째",
    "achievements.c11.firstTime": "처음",
    "achievements.c11.earlier": "그 전 {{count}}번",
    "achievements.c11.earlierOne": "그 전 1번",
    "achievements.c11.notStarted": "아직 시작 전이에요",
    "achievements.c11.historyEmpty": "얻은 날이 여기에 차례로 쌓여요.",
    "achievements.c11.nearLabel": "{{name}}, {{left}}",
    "achievements.c11.nearDone": "모든 메달이 가장 높은 단계예요",
    "achievements.c11.nextGoal": "다음 목표: {{name}} · {{left}}",
    "achievements.c11.nextMedal": "다음 메달",
    "achievements.c11.groupNext": "{{group}}의 다음 업적",
  },
  es: {
    "achievements.c11.firstEarned": "Primera vez",
    "achievements.c11.nth": "{{count}}.ª vez",
    "achievements.c11.firstTime": "Primera vez",
    "achievements.c11.earlier": "{{count}} veces antes",
    "achievements.c11.earlierOne": "1 vez antes",
    "achievements.c11.notStarted": "Aún sin empezar",
    "achievements.c11.historyEmpty": "Cada día que lo consigas aparecerá aquí.",
    "achievements.c11.nearLabel": "{{name}}, {{left}}",
    "achievements.c11.nearDone": "Todas las medallas están en su nivel más alto",
    "achievements.c11.nextGoal": "Lo siguiente: {{name}}, {{left}}",
    "achievements.c11.nextMedal": "Próxima medalla",
    "achievements.c11.groupNext": "Lo siguiente en {{group}}",
  },
  de: {
    "achievements.c11.firstEarned": "Zuerst erreicht",
    "achievements.c11.nth": "{{count}}. Mal",
    "achievements.c11.firstTime": "Erstes Mal",
    "achievements.c11.earlier": "{{count}}-mal davor",
    "achievements.c11.earlierOne": "Einmal davor",
    "achievements.c11.notStarted": "Noch nicht begonnen",
    "achievements.c11.historyEmpty": "Jeder Tag, an dem du es erreichst, erscheint hier.",
    "achievements.c11.nearLabel": "{{name}}, {{left}}",
    "achievements.c11.nearDone": "Alle Medaillen haben ihre höchste Stufe",
    "achievements.c11.nextGoal": "Als Nächstes: {{name}}, {{left}}",
    "achievements.c11.nextMedal": "Nächste Medaille",
    "achievements.c11.groupNext": "Als Nächstes in {{group}}",
  },
  fr: {
    "achievements.c11.firstEarned": "Première fois",
    "achievements.c11.nth": "{{count}}e fois",
    "achievements.c11.firstTime": "Première fois",
    "achievements.c11.earlier": "{{count}} fois avant",
    "achievements.c11.earlierOne": "1 fois avant",
    "achievements.c11.notStarted": "Pas encore commencé",
    "achievements.c11.historyEmpty": "Chaque jour où vous l’obtenez s’affichera ici.",
    "achievements.c11.nearLabel": "{{name}}, {{left}}",
    "achievements.c11.nearDone": "Toutes les médailles sont à leur plus haut niveau",
    "achievements.c11.nextGoal": "Prochain objectif : {{name}}, {{left}}",
    "achievements.c11.nextMedal": "Prochaine médaille",
    "achievements.c11.groupNext": "Ensuite dans {{group}}",
  },
  ja: {
    "achievements.c11.firstEarned": "初めて獲得",
    "achievements.c11.nth": "{{count}}回目",
    "achievements.c11.firstTime": "初めて",
    "achievements.c11.earlier": "それ以前に{{count}}回",
    "achievements.c11.earlierOne": "それ以前に1回",
    "achievements.c11.notStarted": "まだ始まっていません",
    "achievements.c11.historyEmpty": "獲得した日がここに並びます。",
    "achievements.c11.nearLabel": "{{name}}、{{left}}",
    "achievements.c11.nearDone": "すべてのメダルが最高段階です",
    "achievements.c11.nextGoal": "次の目標：{{name}}・{{left}}",
    "achievements.c11.nextMedal": "次のメダル",
    "achievements.c11.groupNext": "{{group}}の次の実績",
  },
  ptBR: {
    "achievements.c11.firstEarned": "Primeira vez",
    "achievements.c11.nth": "{{count}}ª vez",
    "achievements.c11.firstTime": "Primeira vez",
    "achievements.c11.earlier": "{{count}} vezes antes",
    "achievements.c11.earlierOne": "1 vez antes",
    "achievements.c11.notStarted": "Ainda não começou",
    "achievements.c11.historyEmpty": "Cada dia em que você conquistar aparece aqui.",
    "achievements.c11.nearLabel": "{{name}}, {{left}}",
    "achievements.c11.nearDone": "Todas as medalhas estão no nível mais alto",
    "achievements.c11.nextGoal": "Próxima meta: {{name}}, {{left}}",
    "achievements.c11.nextMedal": "Próxima medalha",
    "achievements.c11.groupNext": "Próxima em {{group}}",
  },
  zhHans: {
    "achievements.c11.firstEarned": "首次获得",
    "achievements.c11.nth": "第 {{count}} 次",
    "achievements.c11.firstTime": "第一次",
    "achievements.c11.earlier": "更早还有 {{count}} 次",
    "achievements.c11.earlierOne": "更早还有 1 次",
    "achievements.c11.notStarted": "尚未开始",
    "achievements.c11.historyEmpty": "每次获得的日期都会列在这里。",
    "achievements.c11.nearLabel": "{{name}}，{{left}}",
    "achievements.c11.nearDone": "所有奖牌都已达到最高等级",
    "achievements.c11.nextGoal": "下一个目标：{{name}}，{{left}}",
    "achievements.c11.nextMedal": "下一枚奖牌",
    "achievements.c11.groupNext": "{{group}}的下一个成就",
  },
};
