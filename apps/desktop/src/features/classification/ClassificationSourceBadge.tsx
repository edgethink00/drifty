import type { ClassificationSource } from "@drifty/domain";
import { classificationSourceLabel } from "./classificationViewData";

export function ClassificationSourceBadge({
  source,
  ai,
  aiCached,
}: {
  source?: ClassificationSource | string | null;
  ai?: boolean | null;
  aiCached?: boolean | null;
}) {
  const isAi = Boolean(ai || source === "llm");
  const label = classificationSourceLabel(source, ai, aiCached);

  return (
    <span
      aria-label={`Classification source: ${label}`}
      className={`hover-metadata-chip classification-source-badge${isAi ? " classification-source-badge--ai" : ""}`}
    >
      {label}
    </span>
  );
}
