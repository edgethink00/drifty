import { formatCompactDurationFromSeconds } from "../../lib/formatting";

type CompactChartLabelEntry = {
  readonly totalSeconds: number;
  readonly ratio: number;
};

export function formatCompactBarLabel<TEntry extends CompactChartLabelEntry>(
  title: string,
  entries: readonly TEntry[],
  getLabel: (entry: TEntry) => string,
) {
  const parts = entries.map((entry) => `${getLabel(entry)} ${formatCompactDurationFromSeconds(entry.totalSeconds)} ${Math.round(entry.ratio * 100)}%`);
  return `${title} classification: ${parts.join(", ")}`;
}
