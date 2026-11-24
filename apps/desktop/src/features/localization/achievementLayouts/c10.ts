/**
 * Strings of layout c10 (layouts/c10): a summary column beside the medal
 * cabinet, and the chosen achievement's record as a band with a year strip.
 * Only the c10 worker edits this file; same shape as c1.ts: `en` fixes the
 * keys, each starting with "achievements.c10.", and every other language
 * gives exactly those keys. Shared achievement copy is reused wherever it
 * already says the thing.
 */
import type { LayoutStrings } from "./layoutStrings";

const en = {
  // Summary column: the label under the large count of held achievements.
  "achievements.c10.held": "Achievements held",
  // Summary column: heading over the held-by-tier list, by rarity tier or by medal metal.
  "achievements.c10.byTier": "By rarity",
  "achievements.c10.byMedal": "By medal",
  // Summary column before anything is earned.
  "achievements.c10.noneHeld": "Nothing earned yet",
  // A tile or a history day: which time it was ({{count}} is the number).
  "achievements.c10.nth": "#{{count}}",
  // New-achievement card, beside the large medal of a repeated achievement.
  "achievements.c10.nthCard": "{{count}} times now",
  // Beside a medal: how many times it was earned.
  "achievements.c10.multiplier": "×{{count}}",
  // Detail band fact: the day it was first earned.
  "achievements.c10.firstEarned": "First earned",
  // Caption over the year strip of earned days.
  "achievements.c10.lastMonths": "Last {{count}} months",
  // Times folded into a running total, older than the kept days.
  "achievements.c10.earlier": "{{count}} earlier",
  "achievements.c10.earlierNote": "before the days this computer keeps",
  // Toggle under a long list of earned days.
  "achievements.c10.showAll": "Show all {{count}}",
  "achievements.c10.showFewer": "Show fewer",
  // A tile with nothing to show yet.
  "achievements.c10.notYet": "Not yet",
  // New-achievement card: the closest goal after this one.
  "achievements.c10.nextGoal": "Next: {{name}}, {{left}}",
};

export const C10_STRINGS: LayoutStrings<"c10", typeof en> = {
  en,
  ko: {
    "achievements.c10.held": "모은 업적",
    "achievements.c10.byTier": "희귀도별",
    "achievements.c10.byMedal": "메달별",
    "achievements.c10.noneHeld": "아직 얻은 업적이 없어요",
    "achievements.c10.nth": "{{count}}번째",
    "achievements.c10.nthCard": "{{count}}번째",
    "achievements.c10.multiplier": "×{{count}}",
    "achievements.c10.firstEarned": "처음 얻은 날",
    "achievements.c10.lastMonths": "최근 {{count}}개월",
    "achievements.c10.earlier": "그 전 {{count}}번",
    "achievements.c10.earlierNote": "이 컴퓨터에 날짜가 남아 있지 않은 기록",
    "achievements.c10.showAll": "{{count}}일 모두 보기",
    "achievements.c10.showFewer": "접기",
    "achievements.c10.notYet": "아직",
    "achievements.c10.nextGoal": "다음 목표: {{name}} · {{left}}",
  },
  es: {
    "achievements.c10.held": "Logros conseguidos",
    "achievements.c10.byTier": "Por rareza",
    "achievements.c10.byMedal": "Por medalla",
    "achievements.c10.noneHeld": "Aún no has conseguido ninguno",
    "achievements.c10.nth": "#{{count}}",
    "achievements.c10.nthCard": "Ya van {{count}} veces",
    "achievements.c10.multiplier": "×{{count}}",
    "achievements.c10.firstEarned": "Primera vez",
    "achievements.c10.lastMonths": "Últimos {{count}} meses",
    "achievements.c10.earlier": "{{count}} anteriores",
    "achievements.c10.earlierNote": "antes de los días que guarda esta computadora",
    "achievements.c10.showAll": "Ver los {{count}}",
    "achievements.c10.showFewer": "Ver menos",
    "achievements.c10.notYet": "Aún no",
    "achievements.c10.nextGoal": "Lo siguiente: {{name}}, {{left}}",
  },
  de: {
    "achievements.c10.held": "Erreichte Erfolge",
    "achievements.c10.byTier": "Nach Seltenheit",
    "achievements.c10.byMedal": "Nach Medaille",
    "achievements.c10.noneHeld": "Noch nichts erreicht",
    "achievements.c10.nth": "#{{count}}",
    "achievements.c10.nthCard": "Schon {{count}}-mal",
    "achievements.c10.multiplier": "×{{count}}",
    "achievements.c10.firstEarned": "Erstmals erreicht",
    "achievements.c10.lastMonths": "Letzte {{count}} Monate",
    "achievements.c10.earlier": "{{count}} davor",
    "achievements.c10.earlierNote": "vor den Tagen, die dieser Computer aufbewahrt",
    "achievements.c10.showAll": "Alle {{count}} zeigen",
    "achievements.c10.showFewer": "Weniger zeigen",
    "achievements.c10.notYet": "Noch nicht",
    "achievements.c10.nextGoal": "Als Nächstes: {{name}}, {{left}}",
  },
  fr: {
    "achievements.c10.held": "Succès obtenus",
    "achievements.c10.byTier": "Par rareté",
    "achievements.c10.byMedal": "Par médaille",
    "achievements.c10.noneHeld": "Rien d’obtenu pour l’instant",
    "achievements.c10.nth": "n° {{count}}",
    "achievements.c10.nthCard": "Déjà {{count}} fois",
    "achievements.c10.multiplier": "×{{count}}",
    "achievements.c10.firstEarned": "Première fois",
    "achievements.c10.lastMonths": "{{count}} derniers mois",
    "achievements.c10.earlier": "{{count}} plus anciennes",
    "achievements.c10.earlierNote": "avant les jours conservés sur cet ordinateur",
    "achievements.c10.showAll": "Tout afficher ({{count}})",
    "achievements.c10.showFewer": "Afficher moins",
    "achievements.c10.notYet": "Pas encore",
    "achievements.c10.nextGoal": "Ensuite : {{name}}, {{left}}",
  },
  ja: {
    "achievements.c10.held": "獲得した実績",
    "achievements.c10.byTier": "レア度別",
    "achievements.c10.byMedal": "メダル別",
    "achievements.c10.noneHeld": "まだ獲得した実績はありません",
    "achievements.c10.nth": "{{count}}回目",
    "achievements.c10.nthCard": "{{count}}回目",
    "achievements.c10.multiplier": "×{{count}}",
    "achievements.c10.firstEarned": "初めて獲得した日",
    "achievements.c10.lastMonths": "過去{{count}}か月",
    "achievements.c10.earlier": "それ以前に{{count}}回",
    "achievements.c10.earlierNote": "このコンピュータに日付が残っていない記録",
    "achievements.c10.showAll": "{{count}}日すべて表示",
    "achievements.c10.showFewer": "折りたたむ",
    "achievements.c10.notYet": "まだ",
    "achievements.c10.nextGoal": "次の目標: {{name}}・{{left}}",
  },
  ptBR: {
    "achievements.c10.held": "Conquistas obtidas",
    "achievements.c10.byTier": "Por raridade",
    "achievements.c10.byMedal": "Por medalha",
    "achievements.c10.noneHeld": "Nada conquistado ainda",
    "achievements.c10.nth": "#{{count}}",
    "achievements.c10.nthCard": "Já são {{count}} vezes",
    "achievements.c10.multiplier": "×{{count}}",
    "achievements.c10.firstEarned": "Primeira vez",
    "achievements.c10.lastMonths": "Últimos {{count}} meses",
    "achievements.c10.earlier": "{{count}} anteriores",
    "achievements.c10.earlierNote": "antes dos dias guardados neste computador",
    "achievements.c10.showAll": "Ver todos os {{count}}",
    "achievements.c10.showFewer": "Ver menos",
    "achievements.c10.notYet": "Ainda não",
    "achievements.c10.nextGoal": "Próximo: {{name}}, {{left}}",
  },
  zhHans: {
    "achievements.c10.held": "已获得的成就",
    "achievements.c10.byTier": "按稀有度",
    "achievements.c10.byMedal": "按奖牌",
    "achievements.c10.noneHeld": "还没有获得成就",
    "achievements.c10.nth": "第 {{count}} 次",
    "achievements.c10.nthCard": "第 {{count}} 次",
    "achievements.c10.multiplier": "×{{count}}",
    "achievements.c10.firstEarned": "首次获得",
    "achievements.c10.lastMonths": "最近 {{count}} 个月",
    "achievements.c10.earlier": "更早 {{count}} 次",
    "achievements.c10.earlierNote": "早于这台电脑保留的日期",
    "achievements.c10.showAll": "显示全部 {{count}} 天",
    "achievements.c10.showFewer": "收起",
    "achievements.c10.notYet": "尚未获得",
    "achievements.c10.nextGoal": "下一个目标：{{name}}，{{left}}",
  },
};
