/**
 * One palette for every agents-page series.
 *
 * Three separate hand-picked colour lists had grown across this feature — one
 * for the flow grid's repo mode, one for the models donut, one for the repo
 * bar — none of them drawn from the app's own colours, and the grid and the
 * donut disagreed about what colour a given repo was. Both problems have the
 * same fix: take the project swatches the app already ships and assign them
 * from one place, so a repo keeps its colour across the whole page and the
 * hues belong to the product.
 */

import { PROJECT_COLOR_SWATCHES } from "../../components/ProjectEditorFields";
import { NO_PROJECT_COLOR } from "../flow-chart/projectFlowView";

/** Series colours, in the order the project editor offers them. */
export const AGENTS_SERIES_PALETTE: readonly string[] = PROJECT_COLOR_SWATCHES.map((swatch) => swatch.color);

/** Unresolved repo / unlabelled series: the same grey unassigned time uses. */
export const AGENTS_UNKNOWN_COLOR = NO_PROJECT_COLOR;

export function agentsSeriesColor(index: number): string {
  return AGENTS_SERIES_PALETTE[index % AGENTS_SERIES_PALETTE.length] ?? AGENTS_UNKNOWN_COLOR;
}

/**
 * Stable colour per key for one period.
 *
 * Keys are ranked by the caller (most active first), so the busiest repo gets
 * the first swatch on both the grid and the donut. Rank-based rather than
 * hash-based because the legend reads top-down: adjacent rows should not
 * collide, which a hash cannot promise.
 */
export function agentsSeriesColors(keys: readonly string[]): Map<string, string> {
  const colors = new Map<string, string>();
  keys.forEach((key, index) => colors.set(key, agentsSeriesColor(index)));
  return colors;
}
