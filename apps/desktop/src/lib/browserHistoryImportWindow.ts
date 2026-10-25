/**
 * The first-run browser-history import window. 72 hours reaches back past the start of the day before
 * yesterday, so today so far, yesterday and the whole day before are all imported: the three days
 * first-day preparation can choose and the intro can tell. The onboarding toggle, preparation line and
 * dashboard import notice name the same window.
 */
export const FIRST_RUN_BROWSER_HISTORY_LOOKBACK_DAYS = 3;
export const FIRST_RUN_BROWSER_HISTORY_LOOKBACK_LABEL = "last 72 hours";
