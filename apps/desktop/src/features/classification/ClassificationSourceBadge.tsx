import type { ClassificationSource } from "@drifty/domain";
import { classificationSourceLabel } from "./classificationViewData";
import type { DisplayLanguage } from "../localization/LocalizationContext";

export function ClassificationSourceBadge({
  source,
  ai,
  aiCached,
  language = "en",
}: {
  source?: ClassificationSource | string | null;
  ai?: boolean | null;
  aiCached?: boolean | null;
  language?: DisplayLanguage;
}) {
  const isAi = Boolean(ai || source === "llm");
  const label = language === "ko" ? koreanClassificationSourceLabel(source, ai, aiCached) : classificationSourceLabel(source, ai, aiCached);

  return (
    <span
      aria-label={language === "ko" ? `분류 출처: ${label}` : `Classification source: ${label}`}
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
