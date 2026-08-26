import { useCallback, useEffect, useRef, useState } from "react";
import { trackerClient } from "../../lib/api/trackerClient";
import { shouldUsePreviewData } from "../../lib/api/previewData";
import { fetchSyncDevices, fetchSyncedDeletionsPage, fetchSyncedSegmentsPage, pushSyncBatch } from "./deviceSyncApi";
import { runSyncCycle } from "./deviceSyncEngine";
import {
  findDeviceSyncCycleRecord,
  readDeviceSyncCycleRecords,
  shouldRunDeviceSyncCycle,
  upsertDeviceSyncCycleRecord,
  writeDeviceSyncCycleRecords,
} from "./deviceSyncState";
import { IDLE_DEVICE_SYNC_STATUS, type DeviceSyncCycleReason, type DeviceSyncStatus } from "./deviceSyncTypes";

export const DEVICE_SYNC_CYCLE_INTERVAL_MS = 3 * 60 * 1000;

export type UseDeviceSyncControllerOptions = {
  /** Full gate: opt-in toggle AND cloud online AND signed in AND canUseApp. */
  readonly syncActive: boolean;
  /** Stable per-account key for pacing records (falls back to "anonymous"). */
  readonly userScopeKey: string;
  /** Called after a pull applies remote segments, so timelines can reload. */
  readonly onRemoteSegmentsApplied?: (appliedCount: number) => void;
};

export type DeviceSyncController = {
  readonly status: DeviceSyncStatus;
  readonly deviceLabelById: ReadonlyMap<string, string>;
  readonly syncNow: () => Promise<void>;
  /** Blocks new cycles and resolves only after the current cycle has settled. */
  readonly quiesce: () => Promise<void>;
};

export function useDeviceSyncController({
  syncActive,
  userScopeKey,
  onRemoteSegmentsApplied,
}: UseDeviceSyncControllerOptions): DeviceSyncController {
  const [status, setStatus] = useState<DeviceSyncStatus>(IDLE_DEVICE_SYNC_STATUS);
  const [deviceLabelById, setDeviceLabelById] = useState<ReadonlyMap<string, string>>(new Map());
  const inFlightPromiseRef = useRef<Promise<void> | null>(null);
  const quiescedRef = useRef(false);
  const syncActiveRef = useRef(syncActive);
  syncActiveRef.current = syncActive;
  const onRemoteSegmentsAppliedRef = useRef(onRemoteSegmentsApplied);
  onRemoteSegmentsAppliedRef.current = onRemoteSegmentsApplied;

  const refreshDeviceLabels = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetchSyncDevices();
      const labels = new Map<string, string>();
      for (const device of response.devices) {
        labels.set(device.id, device.label);
      }
      setDeviceLabelById(labels);
      return response.deviceId;
    } catch (error) {
      console.warn("device sync label refresh failed", error);
      return null;
    }
  }, []);

  const runCycle = useCallback(
    async (reason: DeviceSyncCycleReason) => {
      if (!syncActiveRef.current || quiescedRef.current || inFlightPromiseRef.current || shouldUsePreviewData()) return;

      const records = readDeviceSyncCycleRecords();
      const record = findDeviceSyncCycleRecord(records, userScopeKey);
      const decision = shouldRunDeviceSyncCycle({ record, now: new Date(), reason });
      if (!decision.shouldRun) return;

      const attemptAt = new Date().toISOString();
      const cyclePromise = (async () => {
        try {
          const result = await runSyncCycle(
            {
              tracker: trackerClient,
              pushBatch: pushSyncBatch,
              fetchPullPage: fetchSyncedSegmentsPage,
              fetchDeletionsPullPage: fetchSyncedDeletionsPage,
              resolveDeviceId: refreshDeviceLabels,
            },
            reason,
          );
          setStatus(result.status);
          writeDeviceSyncCycleRecords(
            upsertDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), {
              userScopeKey,
              lastAttemptAt: attemptAt,
              lastSuccessAt: new Date().toISOString(),
              lastErrorAt: null,
            }),
          );
          if (deviceLabelById.size === 0 || result.pulledCount > 0) {
            void refreshDeviceLabels();
          }
          if (result.pulledCount > 0) {
            onRemoteSegmentsAppliedRef.current?.(result.pulledCount);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setStatus((previous) => ({ ...previous, enabled: true, lastError: message }));
          writeDeviceSyncCycleRecords(
            upsertDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), {
              userScopeKey,
              lastAttemptAt: attemptAt,
              lastSuccessAt: record?.lastSuccessAt ?? null,
              lastErrorAt: new Date().toISOString(),
            }),
          );
          console.warn("device sync cycle failed", error);
        }
      })();
      inFlightPromiseRef.current = cyclePromise;
      try {
        await cyclePromise;
      } finally {
        if (inFlightPromiseRef.current === cyclePromise) inFlightPromiseRef.current = null;
      }
    },
    [deviceLabelById.size, refreshDeviceLabels, userScopeKey],
  );

  useEffect(() => {
    if (syncActive) quiescedRef.current = false;
  }, [syncActive]);

  useEffect(() => {
    if (!syncActive || shouldUsePreviewData()) {
      setStatus((previous) => (previous.enabled ? IDLE_DEVICE_SYNC_STATUS : previous));
      return undefined;
    }
    void runCycle("startup");
    const intervalId = window.setInterval(() => {
      void runCycle("interval");
    }, DEVICE_SYNC_CYCLE_INTERVAL_MS);

    function handleFocus() {
      void runCycle("focus");
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void runCycle("visibility");
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [runCycle, syncActive]);

  const syncNow = useCallback(async () => {
    await runCycle("manual");
  }, [runCycle]);

  const quiesce = useCallback((): Promise<void> => {
    quiescedRef.current = true;
    return inFlightPromiseRef.current ?? Promise.resolve();
  }, []);

  return { status, deviceLabelById, syncNow, quiesce };
}
