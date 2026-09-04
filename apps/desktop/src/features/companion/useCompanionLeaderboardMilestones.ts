import { useEffect, useRef } from "react";
import { fetchOwnLeaderboardCheckpoint } from "../leaderboard/leaderboardService";
import type { StartOfWeek } from "../settings/settingsStorage";
import {
  evaluateCompanionWeeklyLeaderboardMilestone,
  getCompanionWeeklyResultWindowEndDay,
  initializeCompanionLeaderboardMilestones,
  persistCompanionLeaderboardMilestones,
  WEEKLY_LEADERBOARD_RESULT_MINUTE,
  type CompanionLeaderboardMilestoneProgress,
} from "./companionLeaderboardMilestones";
import { isTauriRuntime, showNativeCompanionMilestone } from "./watcherBridge";

const COMPANION_WEEKLY_RESULT_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export function useCompanionLeaderboardMilestones({
  ready,
  recoveryPending = false,
  userScopeKey,
  calendarDay,
  startOfDayMinutes,
  startOfWeek,
  announcementsEnabled,
  publishCheckpoint,
}: {
  readonly ready: boolean;
  readonly recoveryPending?: boolean;
  readonly userScopeKey: string | null;
  readonly calendarDay: string;
  readonly startOfDayMinutes: number;
  readonly startOfWeek: StartOfWeek;
  readonly announcementsEnabled: boolean;
  readonly publishCheckpoint: (period: "weekly", windowEndDay: string) => Promise<boolean>;
}) {
  const progressRef = useRef<CompanionLeaderboardMilestoneProgress | null>(null);
  const lastRefreshAtRef = useRef(0);
  const suppressRecoveredResultRef = useRef(false);
  const announcementsEnabledRef = useRef(announcementsEnabled);
  announcementsEnabledRef.current = announcementsEnabled;

  useEffect(() => {
    if (recoveryPending) suppressRecoveredResultRef.current = true;
  }, [recoveryPending]);

  useEffect(() => {
    if (!ready || !userScopeKey) {
      progressRef.current = null;
      return undefined;
    }

    let cancelled = false;
    let inFlight = false;
    let nextMorningTimer = 0;
    progressRef.current = initializeCompanionLeaderboardMilestones(userScopeKey);

    const refresh = async (respectCooldown = false) => {
      if (cancelled || inFlight || !progressRef.current) return;
      if (
        respectCooldown
        && Date.now() - lastRefreshAtRef.current < COMPANION_WEEKLY_RESULT_REFRESH_COOLDOWN_MS
      ) return;

      const now = new Date();
      const currentMinuteOfDay = now.getHours() * 60 + now.getMinutes();
      const windowEndDay = getCompanionWeeklyResultWindowEndDay(
        calendarDay,
        currentMinuteOfDay,
        startOfWeek,
        startOfDayMinutes,
      );
      // Before the weekly result minute there is no finalized window yet.
      // Keep a recovery suppression armed so that same recovered result is
      // stored, but not announced, when the morning timer reaches it.
      if (!windowEndDay) return;
      if (
        progressRef.current.lastWeeklyWindowEndDay
        && progressRef.current.lastWeeklyWindowEndDay >= windowEndDay
      ) {
        suppressRecoveredResultRef.current = false;
        return;
      }

      inFlight = true;
      try {
        const published = await publishCheckpoint("weekly", windowEndDay);
        if (cancelled || !published) return;
        const result = await fetchOwnLeaderboardCheckpoint("weekly", windowEndDay);
        if (cancelled || !progressRef.current || !result.success) return;
        lastRefreshAtRef.current = Date.now();
        const evaluation = evaluateCompanionWeeklyLeaderboardMilestone({
          progress: progressRef.current,
          windowEndDay,
          entry: result.data ?? null,
          announce: !suppressRecoveredResultRef.current
            && announcementsEnabledRef.current
            && isTauriRuntime(),
        });
        suppressRecoveredResultRef.current = false;
        progressRef.current = evaluation.progress;
        persistCompanionLeaderboardMilestones(evaluation.progress);
        if (evaluation.event) {
          void showNativeCompanionMilestone(evaluation.event).catch((error: unknown) => {
            console.warn("Failed to show a finalized Companion weekly leaderboard result", error);
          });
        }
      } finally {
        inFlight = false;
      }
    };

    const scheduleNextMorning = () => {
      if (cancelled) return;
      const now = new Date();
      const next = new Date(now);
      const resultMinute = Math.max(WEEKLY_LEADERBOARD_RESULT_MINUTE, startOfDayMinutes);
      next.setHours(
        Math.floor(resultMinute / 60),
        resultMinute % 60,
        30,
        0,
      );
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      nextMorningTimer = window.setTimeout(() => {
        void refresh();
        scheduleNextMorning();
      }, next.getTime() - now.getTime());
    };
    const refreshAfterAttention = () => void refresh(true);
    const refreshAfterVisibility = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };

    void refresh();
    scheduleNextMorning();
    window.addEventListener("focus", refreshAfterAttention);
    document.addEventListener("visibilitychange", refreshAfterVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(nextMorningTimer);
      window.removeEventListener("focus", refreshAfterAttention);
      document.removeEventListener("visibilitychange", refreshAfterVisibility);
    };
  }, [calendarDay, publishCheckpoint, ready, startOfDayMinutes, startOfWeek, userScopeKey]);
}
