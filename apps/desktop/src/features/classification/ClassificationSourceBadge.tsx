import { isAdditionalDisplayLanguage, supplementalText } from "../localization/supplementalCopy";
import type { ClassificationSource } from "@drifty/domain";
import { classificationSourceLabel } from "./classificationViewData";
import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";

export function ClassificationSourceBadge({
  source,
  ai,
  aiCached,
  language: languageOverride,
  showAutomaticSources = false,
}: {
  source?: ClassificationSource | string | null;
  ai?: boolean | null;
  aiCached?: boolean | null;
  language?: DisplayLanguage;
  /** Dev-only provenance inspection. Normal product UI shows only user-owned decisions. */
  showAutomaticSources?: boolean;
}) {
  // Follows the display language unless a caller pins one, like the other
  // hover-card pieces.
  const { effectiveLanguage } = useLocalization();
  const language = languageOverride ?? effectiveLanguage;
  const userOwnedSource = source === "manual" || source === "rule";
  if (!userOwnedSource && !showAutomaticSources) return null;
  const isAi = Boolean(ai || source === "llm");
  const label = isAdditionalDisplayLanguage(language) ? supplementalText(language, classificationSourceLabel(source, ai, aiCached)) : language === "ko" ? koreanClassificationSourceLabel(source, ai, aiCached) : language === "es" ? spanishClassificationSourceLabel(source, ai, aiCached) : classificationSourceLabel(source, ai, aiCached);

  return (
    <span
      aria-label={(isAdditionalDisplayLanguage(language) ? supplementalText(language, "Classification source: {{v0}}", { v0: label }) : language === "ko" ? `분류 출처: ${label}` : language === "es" ? `Origen de clasificación: ${label}` : `Classification source: ${label}`)}
      className={`hover-metadata-chip classification-source-badge${isAi ? " classification-source-badge--ai" : ""}`}
    >
      {label}
    </span>
  );
}

function koreanClassificationSourceLabel(source?: ClassificationSource | string | null, ai?: boolean | null, aiCached?: boolean | null): string {
  if (ai || source === "llm") return aiCached ? "AI 캐시" : "AI";
  if (source === "domain-db" || source === "app-db" || source === "youtube") return "사전 정의";
  if (source === "context") return "키워드 규칙";
  if (source === "fallback") return "기본 분류";
  if (source === "manual") return "수동";
  if (source === "rule") return "사용자 규칙";
  if (source === "stored") return "저장됨";
  return "미분류";
}

function spanishClassificationSourceLabel(source?: ClassificationSource | string | null, ai?: boolean | null, aiCached?: boolean | null): string {
  if (ai || source === "llm") return aiCached ? "IA en caché" : "IA";
  if (source === "domain-db" || source === "app-db" || source === "youtube") return "Predefinida";
  if (source === "context") return "Regla de palabras clave";
  if (source === "fallback") return "Clasificación predeterminada";
  if (source === "manual") return "Manual";
  if (source === "rule") return "Regla personalizada";
  if (source === "stored") return "Guardada";
  return "Sin clasificar";
}
