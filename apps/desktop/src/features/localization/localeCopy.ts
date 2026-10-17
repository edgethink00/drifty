import type { DisplayLanguage } from "./languageCatalog";

// Small labels used by formatters before React or the main dictionaries load.
const COPY = {
  en: ["Selected day", "unknown", "Other", "and", "Week", "classification"],
  ko: ["선택한 날짜", "알 수 없음", "기타", "및", "주차", "분류"],
  es: ["Día seleccionado", "desconocido", "Otros", "y", "Semana", "clasificación"],
  ja: ["選択した日", "不明", "その他", "と", "週", "分類"],
  "pt-BR": ["Dia selecionado", "desconhecido", "Outros", "e", "Semana", "classificação"],
  "zh-Hans": ["所选日期", "未知", "其他", "和", "周", "分类"],
  fr: ["Jour sélectionné", "inconnu", "Autres", "et", "Semaine", "classification"],
  de: ["Ausgewählter Tag", "unbekannt", "Andere", "und", "Woche", "Klassifizierung"],
} as const satisfies Record<DisplayLanguage, readonly string[]>;
const INDEX = { selectedDay: 0, unknown: 1, other: 2, and: 3, week: 4, classification: 5 } as const;
export function localeCopy(language: DisplayLanguage, key: keyof typeof INDEX): string {
  return COPY[language][INDEX[key]];
}
