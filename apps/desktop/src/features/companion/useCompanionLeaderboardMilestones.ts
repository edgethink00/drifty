import { useEffect, useRef } from "react";
import { LEADERBOARD_AUTO_PUBLISH_SLOT_MS } from "../leaderboard/leaderboardAutoPublishState";
import { fetchOwnLeaderboardEntry } from "../leaderboard/leaderboardService";
import type { StartOfWeek } from "../settings/settingsStorage";
import {
  evaluateCompanionLeaderboardMilestones,
  getCompanionWeeklyRankClosingDay,
  initializeCompanionLeaderboardMilestones,
  persistCompanionLeaderboardMilestones,
  type CompanionLeaderboardMilestoneProgress,
} from "./companionLeaderboardMilestones";
import { isTauriRuntime, showNativeCompanionMilestone } from "./watcherBridge";

const COMPANION_LEADERBOARD_FOCUS_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export function useCompanionLeaderboardMilestones({
  ready,
  userScopeKey,
  day,
  startOfWeek,
  announcementsEnabled,
}: {
  readonly ready: boolean;
  readonly userScopeKey: string | null;
  readonly day: string;
  readonly startOfWeek: StartOfWeek;
  readonly announcementsEnabled: boolean;
}) {
  const progressRef = useRef<CompanionLeaderboardMilestoneProgress | null>(null);
  const lastRefreshAtRef = useRef(0);
  const announcementsEnabledRef = useRef(announcementsEnabled);
  announcementsEnabledRef.current = announcementsEnabled;

  useEffect(() => {
    if (!ready || !userScopeKey) {
      progressRef.current = null;
      return undefined;
    }

    let cancelled = false;
    let inFlight = false;
    let hourTimer = 0;
    progressRef.current = initializeCompanionLeaderboardMilestones(userScopeKey, day);

    const refresh = async (respectCooldown = false) => {
      if (cancelled || inFlight) return;
      if (respectCooldown && Date.now() - lastRefreshAtRef.current < COMPANION_LEADERBOARD_FOCUS_REFRESH_COOLDOWN_MS) return;
      inFlight = true;
      try {
        const now = new Date();
        const currentMinuteOfDay = now.getHours() * 60 + now.getMinutes();
        const dueWeeklyClosingDay = getCompanionWeeklyRankClosingDay(day, currentMinuteOfDay, startOfWeek);
        const currentProgress = progressRef.current;
        const shouldFetchWeekly = dueWeeklyClosingDay !== null
          && (currentProgress?.weeklyClosingDay !== dueWeeklyClosingDay || currentProgress.bestWeeklyRank !== 1);
        const [dailyResult, weeklyResult] = await Promise.all([
          fetchOwnLeaderboardEntry("daily"),
          shouldFetchWeekly ? fetchOwnLeaderboardEntry("weekly") : Promise.resolve(null),
        ]);
        if (cancelled || !progressRef.current) return;
        lastRefreshAtRef.current = Date.now();
        const dailyEntry = dailyResult.success ? dailyResult.data ?? null : null;
        const weeklyEntry = weeklyResult?.success ? weeklyResult.data ?? null : null;
        const result = evaluateCompanionLeaderboardMilestones({
          progress: progressRef.current,
          day,
          currentMinuteOfDay,
          startOfWeek,
          dailyEntry,
          weeklyEntry,
          announce: announcementsEnabledRef.current && isTauriRuntime(),
        });
        progressRef.current = result.progress;
        persistCompanionLeaderboardMilestones(result.progress);
        for (const event of result.events) {
          void showNativeCompanionMilestone(event).catch((error: unknown) => {
            console.warn("Failed to show a Companion leaderboard milestone", error);
          });
        }
      } finally {
        inFlight = false;
      }
    };

    const scheduleNextHour = () => {
      if (cancelled) return;
      const delay = LEADERBOARD_AUTO_PUBLISH_SLOT_MS
        - (Date.now() % LEADERBOARD_AUTO_PUBLISH_SLOT_MS)
        + 30_000;
      hourTimer = window.setTimeout(() => {
        void refresh();
        scheduleNextHour();
      }, delay);
    };
    const refreshAfterAttention = () => void refresh(true);
    const refreshAfterVisibility = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };

    void refresh();
    scheduleNextHour();
    window.addEventListener("focus", refreshAfterAttention);
    document.addEventListener("visibilitychange", refreshAfterVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(hourTimer);
      window.removeEventListener("focus", refreshAfterAttention);
      document.removeEventListener("visibilitychange", refreshAfterVisibility);
    };
  }, [day, ready, startOfWeek, userScopeKey]);
}
