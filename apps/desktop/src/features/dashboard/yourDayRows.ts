/*
 * Your Day with the flow chart's hours down, beside the day's notes column (YourDayCardLane.tsx),
 * with a time zoom on Your Day and Your Week and activity details in the Breakdown panel. It is a
 * Dev preview, "Hours-down Your Day" (settingsStorage.ts): off by default, so everyone else keeps the
 * hours-across Your Day and the Week as before (owner, 2026-10-21). A review link picks either
 * layout with ?yourDayRows=1 or ?yourDayRows=0, ahead of that switch.
 */

const QUERY_KEY = "yourDayRows";

/** The layout a review link asks for: true for hours down, false for hours across, null for none. */
export function resolveYourDayRowsQuery(): boolean | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(QUERY_KEY);
  return value === "1" ? true : value === "0" ? false : null;
}

/** Hours down only where a review link or the Dev preview asks for it. */
export function resolveYourDayRowsEnabled(query: boolean | null, previewEnabled: boolean): boolean {
  return query ?? previewEnabled;
}
