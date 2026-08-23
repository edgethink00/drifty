import type { ProductivityDuration } from "@drifty/domain";

export const CLASSIFICATION_FOCUS_RATE_LABEL = "Focus rate";
export const CLASSIFICATION_FOCUS_RATE_DESCRIPTION = "Share of tracked time labeled Focus";

/** Share of tracked time whose effective productivity label is Focus. */
export function buildFocusRatePercent(productivityTotals: ProductivityDuration[]): number {
  const totalSeconds = productivityTotals.reduce((total, entry) => total + entry.totalSeconds, 0);
  const focusSeconds = productivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  return totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0;
}
