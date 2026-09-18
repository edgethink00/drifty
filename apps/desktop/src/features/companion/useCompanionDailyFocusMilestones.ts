import { useEffect, useRef } from "react";
import {
  evaluateCompanionDailyFocusMilestones,
  initializeCompanionDailyFocusMilestones,
  persistCompanionDailyFocusMilestones,
  type CompanionDailyFocusMilestoneProgress,
} from "./companionDailyFocusMilestones";
import { isTauriRuntime, showNativeCompanionMilestone } from "./watcherBridge";
import type { Translate } from "../localization/translate";

export function useCompanionDailyFocusMilestones({
  ready,
  day,
  focusSecondsToday,
  announcementsEnabled,
  translate,
}: {
  readonly ready: boolean;
  readonly day: string;
  readonly focusSecondsToday: number;
  readonly announcementsEnabled: boolean;
  readonly translate?: Translate;
}) {
  const progressRef = useRef<CompanionDailyFocusMilestoneProgress | null>(null);
  const translateRef = useRef(translate);
  translateRef.current = translate;

  useEffect(() => {
    /* Losing readiness means the caller can no longer vouch for the figure (the
       loaded day drifted away from the evaluated day, or tracker access closed).
       Dropping the baseline forces the next ready render to re-establish it from
       whatever is true then, so the gap is absorbed instead of being replayed as
       a fresh crossing the moment the numbers come back. */
    if (!ready) {
      progressRef.current = null;
      return;
    }

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
      translate: translateRef.current,
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
