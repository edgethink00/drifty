import { useEffect, useRef } from "react";
import { shiftIsoDate, type ClassificationOptions } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange } from "../../lib/formatting";
import {
  buildCompanionFocusRunRecordBaseline,
  evaluateCompanionFocusRunRecords,
  initializeCompanionFocusRunRecords,
  type CompanionFocusRunRecordBaseline,
  type CompanionFocusRunRecordProgress,
} from "./companionFocusRunMilestones";
import { isTauriRuntime, showNativeCompanionMilestone } from "./watcherBridge";

export function useCompanionFocusRunMilestones({
  ready,
  day,
  startOfDayMinutes,
  currentRunSeconds,
  classificationOptions,
  announcementsEnabled,
}: {
  readonly ready: boolean;
  readonly day: string;
  readonly startOfDayMinutes: number;
  readonly currentRunSeconds: number;
  readonly classificationOptions?: ClassificationOptions;
  readonly announcementsEnabled: boolean;
}) {
  const progressRef = useRef<CompanionFocusRunRecordProgress | null>(null);
  const baselineRef = useRef<CompanionFocusRunRecordBaseline | null>(null);
  const currentRunRef = useRef(currentRunSeconds);
  currentRunRef.current = currentRunSeconds;

  useEffect(() => {
    if (!ready) {
      progressRef.current = null;
      baselineRef.current = null;
      return undefined;
    }

    let cancelled = false;
    progressRef.current = null;
    baselineRef.current = null;
    const range = getLogicalDayRange(shiftIsoDate(day, -29), day, startOfDayMinutes);
    void trackerClient.getTimeline(range).then((segments) => {
      if (cancelled) return;
      const baseline = buildCompanionFocusRunRecordBaseline({
        segments,
        day,
        startOfDayMinutes,
        classificationOptions,
      });
      baselineRef.current = baseline;
      progressRef.current = initializeCompanionFocusRunRecords(
        day,
        currentRunRef.current,
        baseline,
      );
    }).catch((error: unknown) => {
      console.warn("Failed to load Companion focus records", error);
    });

    return () => { cancelled = true; };
  }, [classificationOptions, day, ready, startOfDayMinutes]);

  useEffect(() => {
    const progress = progressRef.current;
    const baseline = baselineRef.current;
    if (!ready || !progress || !baseline) return;

    const result = evaluateCompanionFocusRunRecords({
      progress,
      day,
      currentRunSeconds,
      trackedDays: baseline.trackedDays,
      announce: announcementsEnabled && isTauriRuntime(),
    });
    progressRef.current = result.progress;
    for (const event of result.events) {
      void showNativeCompanionMilestone(event).catch((error: unknown) => {
        console.warn("Failed to show a Companion focus record", error);
      });
    }
  }, [announcementsEnabled, currentRunSeconds, day, ready]);
}
