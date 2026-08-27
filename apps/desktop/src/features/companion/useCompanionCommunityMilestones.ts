import { useEffect, useRef, useState } from "react";
import type { CommunityFocusPercentileModel } from "./communityFocusPercentile";
import { loadCommunityFocusPercentileModels } from "./communityFocusPercentileModelService";
import {
  completeCompanionCommunityMilestoneDelivery,
  evaluateCompanionCommunityMilestone,
  persistCompanionCommunityMilestones,
  readCompanionCommunityMilestones,
} from "./companionCommunityMilestones";
import { isTauriRuntime, showNativeCompanionMilestone } from "./watcherBridge";

export function useCompanionCommunityMilestones({
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
  const [model, setModel] = useState<CommunityFocusPercentileModel | null>(null);
  const progressRef = useRef(readCompanionCommunityMilestones());
  const deliveryInFlightRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    if (!ready || progressRef.current.celebratedDailyTopTen) {
      setModel(null);
      return undefined;
    }
    void loadCommunityFocusPercentileModels().then((models) => {
      if (!disposed) setModel(models.daily);
    }).catch(() => {
      if (!disposed) setModel(null);
    });
    return () => {
      disposed = true;
    };
  }, [day, ready]);

  useEffect(() => {
    if (!ready || deliveryInFlightRef.current) return;
    const evaluation = evaluateCompanionCommunityMilestone({
      progress: progressRef.current,
      day,
      focusSeconds: focusSecondsToday,
      model,
      announce: announcementsEnabled && isTauriRuntime(),
    });
    progressRef.current = evaluation.progress;
    persistCompanionCommunityMilestones(evaluation.progress);
    if (!evaluation.event) return;

    deliveryInFlightRef.current = true;
    void showNativeCompanionMilestone(evaluation.event).then((delivered) => {
      progressRef.current = completeCompanionCommunityMilestoneDelivery(
        progressRef.current,
        day,
        delivered,
      );
      persistCompanionCommunityMilestones(progressRef.current);
    }).catch(() => {
      progressRef.current = completeCompanionCommunityMilestoneDelivery(
        progressRef.current,
        day,
        false,
      );
      persistCompanionCommunityMilestones(progressRef.current);
    }).finally(() => {
      deliveryInFlightRef.current = false;
    });
  }, [announcementsEnabled, day, focusSecondsToday, model, ready]);
}
