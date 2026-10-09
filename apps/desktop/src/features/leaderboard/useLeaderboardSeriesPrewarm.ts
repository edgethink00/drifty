import { useEffect, useState } from "react";
import { scheduleIdleWork } from "../../lib/scheduleIdleWork";

export const LEADERBOARD_SERIES_PREWARM_DELAY_MS = 5000;

/**
 * Turns true once, a few idle seconds after launch, for people who are on the
 * leaderboard. The caller uses it to load the 30-day series before the tab is
 * opened, so the first visit finds the chart data ready.
 */
export function useLeaderboardSeriesPrewarm(eligible: boolean): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!eligible || ready) return undefined;
    let cancelIdleWork: (() => void) | null = null;
    const timeout = window.setTimeout(() => {
      cancelIdleWork = scheduleIdleWork(() => setReady(true));
    }, LEADERBOARD_SERIES_PREWARM_DELAY_MS);
    return () => {
      window.clearTimeout(timeout);
      cancelIdleWork?.();
    };
  }, [eligible, ready]);

  return ready;
}
