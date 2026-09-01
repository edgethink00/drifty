import { formatCompactDurationFromSeconds, formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/LocalizationContext";

type CompactChartLabelEntry = {
  readonly totalSeconds: number;
  readonly ratio: number;
};

export function formatCompactBarLabel<TEntry extends CompactChartLabelEntry>(
  title: string,
  entries: readonly TEntry[],
  getLabel: (entry: TEntry) => string,
  language: DisplayLanguage = "en",
) {
  const parts = entries.map((entry) => `${getLabel(entry)} ${language === "ko" ? formatLocalizedCompactDurationFromSeconds(entry.totalSeconds, language) : formatCompactDurationFromSeconds(entry.totalSeconds)} ${Math.round(entry.ratio * 100)}%`);
  return `${title} ${language === "ko" ? "분류" : "classification"}: ${parts.join(", ")}`;
}
