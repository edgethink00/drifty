import { useEffect, useRef } from "react";
import {
  evaluateCompanionDailyFocusMilestones,
  initializeCompanionDailyFocusMilestones,
  persistCompanionDailyFocusMilestones,
  type CompanionDailyFocusMilestoneProgress,
} from "./companionDailyFocusMilestones";
import { isTauriRuntime, showNativeCompanionMilestone } from "./watcherBridge";

export function useCompanionDailyFocusMilestones({
  ready,
  day,
  focusSecondsToday,
  announcementsEnabled,
}: {
  readonly ready: boolean;
  readonly day: string;
  readonly focusSecondsToday: number;
  readonly announcementsEnabled: boolean;
}) {
  const progressRef = useRef<CompanionDailyFocusMilestoneProgress | null>(null);

  useEffect(() => {
    if (!ready) return;

    if (progressRef.current === null) {
      const initial = initializeCompanionDailyFocusMilestones(day, focusSecondsToday);
      progressRef.current = initial;
      persistCompanionDailyFocusMilestones(initial);
      return;
    }

    const result = evaluateCompanionDailyFocusMilestones({
      progress: progressRef.current,
      day,
      focusSecondsToday,
      announce: announcementsEnabled && isTauriRuntime(),
    });
    progressRef.current = result.progress;
    persistCompanionDailyFocusMilestones(result.progress);

    for (const event of result.events) {
      void showNativeCompanionMilestone(event).catch((error: unknown) => {
        console.warn("Failed to show a Companion focus milestone", error);
      });
    }
  }, [announcementsEnabled, day, focusSecondsToday, ready]);
}
