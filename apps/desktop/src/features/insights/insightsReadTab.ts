/**
 * Product gate for the Insights "Your read" tab.
 *
 * Usage ships without that tab. The coach panel, readiness math, and tab
 * wiring stay in the tree so the tab can return by flipping this flag.
 * Do not delete InsightsCoachPanel or insightsReadiness to hide the tab.
 */
export const INSIGHTS_READ_TAB_ENABLED = false;

/**
 * Dev-server design review only: ?driftyRead=1 shows the tab with fixture
 * content. import.meta.env.DEV is false in production builds, so this branch
 * is removed there and the product gate above stays authoritative.
 */
export function isInsightsReadDesignPreview(): boolean {
  return import.meta.env.DEV
    && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("driftyRead") === "1";
}

export function isInsightsReadTabEnabled(): boolean {
  return INSIGHTS_READ_TAB_ENABLED || isInsightsReadDesignPreview();
}
