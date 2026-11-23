/**
 * Strings of layout c6 (layouts/c6), "gallery and drawer". Only the c6 worker
 * edits this file; the shape is explained at the top of c1.ts.
 *
 * c6 reuses the shared achievement copy wherever it already says the thing;
 * these are only the words it adds.
 */
import type { LayoutStrings } from "./layoutStrings";

const en = {
  // A gallery tile's status line for an achievement with nothing to show yet.
  "achievements.c6.notYet": "Not yet",
  // The collapsed drawer's button that opens the full detail sheet.
  "achievements.c6.more": "Details",
  // The open sheet's button that lowers it back to the bar.
  "achievements.c6.less": "Hide details",
  // Accessible name of the drawer at the bottom of the tab.
  "achievements.c6.drawer": "Selected achievement",
  // The record of an achievement earned more than once, on one line.
  "achievements.c6.repeatRecord": "Earned {{count}} times · latest {{date}}",
  // Under the first-look grid: how many are still to be found.
  "achievements.c6.remaining": "{{count}} more still to find",
  // Under the first-look grid when nothing is left to find.
  "achievements.c6.allFound": "You found all {{count}}",
};

export const C6_STRINGS: LayoutStrings<"c6", typeof en> = {
  en,
  ko: {
    "achievements.c6.notYet": "아직",
    "achievements.c6.more": "자세히",
    "achievements.c6.less": "접기",
    "achievements.c6.drawer": "고른 업적",
    "achievements.c6.repeatRecord": "{{count}}번 얻었어요 · 마지막 {{date}}",
    "achievements.c6.remaining": "아직 {{count}}개가 남았어요",
    "achievements.c6.allFound": "{{count}}개를 모두 찾았어요",
  },
  es: {
    "achievements.c6.notYet": "Aún no",
    "achievements.c6.more": "Detalles",
    "achievements.c6.less": "Ocultar detalles",
    "achievements.c6.drawer": "Logro seleccionado",
    "achievements.c6.repeatRecord": "Obtenido {{count}} veces · última: {{date}}",
    "achievements.c6.remaining": "Aún quedan {{count}} por descubrir",
    "achievements.c6.allFound": "Has encontrado los {{count}}",
  },
  de: {
    "achievements.c6.notYet": "Noch nicht",
    "achievements.c6.more": "Details",
    "achievements.c6.less": "Details ausblenden",
    "achievements.c6.drawer": "Ausgewählter Erfolg",
    "achievements.c6.repeatRecord": "{{count}}-mal erreicht · zuletzt {{date}}",
    "achievements.c6.remaining": "Noch {{count}} zu entdecken",
    "achievements.c6.allFound": "Alle {{count}} gefunden",
  },
  fr: {
    "achievements.c6.notYet": "Pas encore",
    "achievements.c6.more": "Détails",
    "achievements.c6.less": "Masquer les détails",
    "achievements.c6.drawer": "Succès sélectionné",
    "achievements.c6.repeatRecord": "Obtenu {{count}} fois · dernière le {{date}}",
    "achievements.c6.remaining": "Encore {{count}} à découvrir",
    "achievements.c6.allFound": "Les {{count}} sont tous trouvés",
  },
  ja: {
    "achievements.c6.notYet": "まだ",
    "achievements.c6.more": "詳しく",
    "achievements.c6.less": "閉じる",
    "achievements.c6.drawer": "選んだ実績",
    "achievements.c6.repeatRecord": "{{count}}回獲得 · 最新 {{date}}",
    "achievements.c6.remaining": "あと{{count}}個が残っています",
    "achievements.c6.allFound": "{{count}}個すべて見つかりました",
  },
  ptBR: {
    "achievements.c6.notYet": "Ainda não",
    "achievements.c6.more": "Detalhes",
    "achievements.c6.less": "Ocultar detalhes",
    "achievements.c6.drawer": "Conquista selecionada",
    "achievements.c6.repeatRecord": "Conquistado {{count}} vezes · última: {{date}}",
    "achievements.c6.remaining": "Ainda faltam {{count}} para descobrir",
    "achievements.c6.allFound": "Você encontrou todas as {{count}}",
  },
  zhHans: {
    "achievements.c6.notYet": "尚未获得",
    "achievements.c6.more": "详情",
    "achievements.c6.less": "收起",
    "achievements.c6.drawer": "所选成就",
    "achievements.c6.repeatRecord": "已获得 {{count}} 次 · 最近 {{date}}",
    "achievements.c6.remaining": "还有 {{count}} 个等你发现",
    "achievements.c6.allFound": "{{count}} 个已全部找到",
  },
};
