/**
 * Product gate for the Insights "Your read" tab.
 *
 * Usage ships without that tab. The coach panel, readiness math, and tab
 * wiring stay in the tree so the tab can return by flipping this flag.
 * Do not delete InsightsCoachPanel or insightsReadiness to hide the tab.
 */
export const INSIGHTS_READ_TAB_ENABLED = false;

export function isInsightsReadTabEnabled(): boolean {
  return INSIGHTS_READ_TAB_ENABLED;
}
