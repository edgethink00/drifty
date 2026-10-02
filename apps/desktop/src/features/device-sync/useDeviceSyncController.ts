import { useCallback, useEffect, useRef, useState } from "react";
import { trackerClient } from "../../lib/api/trackerClient";
import { shouldUsePreviewData } from "../../lib/api/previewData";
import { DeviceSyncHttpError, fetchSyncDevices, fetchSyncedDeletionsPage, fetchSyncedSegmentsPage, pushSyncBatch } from "./deviceSyncApi";
import { prepareDeviceSyncAccountScope } from "./deviceSyncAccountScope";
import { runSyncCycle, SYNC_DEVICE_ID_KEY, SYNC_GENERATION_KEY } from "./deviceSyncEngine";
import { syncExcludedAppsForAccount } from "../settings/excludedAppsAccountSync";
import { buildSyncStateAfterCloudPurge } from "./deviceSyncPurgeState";
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
  /** Stable per-account key for pacing records. */
  readonly userScopeKey: string;
  /** Auth account that owns every request in this controller instance. */
  readonly syncAccountId: string | null;
  /** Called after a pull applies remote segments, so timelines can reload. */
  readonly onRemoteSegmentsApplied?: (appliedCount: number) => void;
  /** Called when an account-wide purge barrier rejects this device's stale state. */
  readonly onAccountSyncPaused?: (syncGeneration: number | null) => void;
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
  syncAccountId,
  onRemoteSegmentsApplied,
  onAccountSyncPaused,
}: UseDeviceSyncControllerOptions): DeviceSyncController {
  const [status, setStatus] = useState<DeviceSyncStatus>(IDLE_DEVICE_SYNC_STATUS);
  const [deviceLabelById, setDeviceLabelById] = useState<ReadonlyMap<string, string>>(new Map());
  const inFlightPromiseRef = useRef<Promise<void> | null>(null);
  const quiescedRef = useRef(false);
  const syncActiveRef = useRef(syncActive);
  syncActiveRef.current = syncActive;
  const syncAccountIdRef = useRef(syncAccountId);
  syncAccountIdRef.current = syncAccountId;
  const scopeIdentityRef = useRef({ syncAccountId, syncActive, version: 0 });
  if (
    scopeIdentityRef.current.syncAccountId !== syncAccountId
    || scopeIdentityRef.current.syncActive !== syncActive
  ) {
    scopeIdentityRef.current = {
      syncAccountId,
      syncActive,
      version: scopeIdentityRef.current.version + 1,
    };
  }
  const onRemoteSegmentsAppliedRef = useRef(onRemoteSegmentsApplied);
  onRemoteSegmentsAppliedRef.current = onRemoteSegmentsApplied;
  const onAccountSyncPausedRef = useRef(onAccountSyncPaused);
  onAccountSyncPausedRef.current = onAccountSyncPaused;

  const loadDeviceAccountState = useCallback(async () => {
    if (!syncAccountId) return null;
    const response = await fetchSyncDevices(syncAccountId);
    if (!syncActiveRef.current || syncAccountIdRef.current !== syncAccountId) return null;
    const labels = new Map<string, string>();
    for (const device of response.devices) {
      labels.set(device.id, device.label);
    }
    setDeviceLabelById(labels);
    if (response.syncStatus === "paused") {
      onAccountSyncPausedRef.current?.(response.syncGeneration);
    }
    return response;
  }, [syncAccountId]);

  const refreshDeviceLabels = useCallback(async (): Promise<string | null> => {
    try {
      return (await loadDeviceAccountState())?.deviceId ?? null;
    } catch (error) {
      console.warn("device sync label refresh failed", error);
      return null;
    }
  }, [loadDeviceAccountState]);

  const runCycle = useCallback(
    async (reason: DeviceSyncCycleReason) => {
      if (!syncActiveRef.current || quiescedRef.current || inFlightPromiseRef.current || shouldUsePreviewData()) return;

      const accountId = syncAccountId!;
      const records = readDeviceSyncCycleRecords();
      const record = findDeviceSyncCycleRecord(records, userScopeKey);
      const decision = shouldRunDeviceSyncCycle({ record, now: new Date(), reason });
      if (!decision.shouldRun) return;

      const attemptAt = new Date().toISOString();
      const scopeVersion = scopeIdentityRef.current.version;
      const isScopeCurrent = () => (
        syncActiveRef.current
        && syncAccountIdRef.current === syncAccountId
        && scopeIdentityRef.current.version === scopeVersion
      );
      const cyclePromise = (async () => {
      try {
        await prepareDeviceSyncAccountScope(trackerClient, accountId, isScopeCurrent);
        if (!isScopeCurrent()) return;
        const localState = await trackerClient.getSyncState();
        if (!isScopeCurrent()) return;
        // Read the account barrier before every cycle, not only first setup.
        // Another device may have purged while this Mac was idle.
        const accountState = await loadDeviceAccountState();
        if (!isScopeCurrent()) return;
        if (!accountState) throw new Error("Device sync account state is unavailable.");
        if (accountState.syncStatus === "paused") return;
        if (localState.state[SYNC_GENERATION_KEY] !== String(accountState.syncGeneration)) {
          await trackerClient.setSyncState(buildSyncStateAfterCloudPurge(accountState.syncGeneration));
          await trackerClient.purgeRemoteSegments();
          onRemoteSegmentsAppliedRef.current?.(0);
        }
        await trackerClient.setSyncState({
          [SYNC_DEVICE_ID_KEY]: accountState.deviceId,
          [SYNC_GENERATION_KEY]: String(accountState.syncGeneration),
        });
        if (!isScopeCurrent()) return;
        const result = await runSyncCycle(
          {
            tracker: trackerClient,
            pushBatch: (segments, deletions, generation) => pushSyncBatch(segments, deletions, generation, accountId),
            fetchPullPage: (cursor, excludeDeviceId) => fetchSyncedSegmentsPage(cursor, excludeDeviceId, accountId),
            fetchDeletionsPullPage: (cursor, excludeDeviceId) => fetchSyncedDeletionsPage(cursor, excludeDeviceId, accountId),
            resolveDeviceId: refreshDeviceLabels,
            syncAccountId: accountId,
            isSyncAccountCurrent: isScopeCurrent,
            syncExcludedApps: (scopeAccountId) => syncExcludedAppsForAccount(scopeAccountId, isScopeCurrent),
          },
          reason,
        );
        if (!isScopeCurrent()) return;
        // A purge can win after the preflight read but before a pull response.
        // Re-read the barrier before exposing the cycle result.
        const finalAccountState = await loadDeviceAccountState();
        if (!isScopeCurrent()) return;
        if (!finalAccountState) throw new Error("Device sync account state is unavailable.");
        if (finalAccountState.syncStatus === "paused") return;
        if (finalAccountState.syncGeneration !== accountState.syncGeneration) {
          await trackerClient.setSyncState(buildSyncStateAfterCloudPurge(finalAccountState.syncGeneration));
          await trackerClient.purgeRemoteSegments();
          onRemoteSegmentsAppliedRef.current?.(0);
          return;
        }
        setStatus(result.status);
        writeDeviceSyncCycleRecords(
          upsertDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), {
            userScopeKey,
            lastAttemptAt: attemptAt,
            lastSuccessAt: new Date().toISOString(),
            lastErrorAt: null,
            consecutiveFailureCount: 0,
            lastErrorCode: null,
            lastErrorHttpStatus: null,
            lastErrorLockedReason: null,
          }),
        );
        if (deviceLabelById.size === 0 || result.pulledCount > 0) {
          void refreshDeviceLabels();
        }
        if (result.pulledCount > 0) {
          onRemoteSegmentsAppliedRef.current?.(result.pulledCount);
        }
      } catch (error) {
        if (!isScopeCurrent()) return;
        const message = error instanceof Error ? error.message : String(error);
        const httpError = error instanceof DeviceSyncHttpError ? error : null;
        const lastErrorCode = httpError?.code ?? (error instanceof Error ? "client_error" : "unknown_error");
        setStatus((previous) => ({
          ...previous,
          enabled: true,
          lastError: message,
          lastErrorCode,
          lastErrorHttpStatus: httpError?.status ?? null,
          lastErrorLockedReason: httpError?.lockedReason ?? null,
        }));
        if (
          error instanceof DeviceSyncHttpError
          && (error.code === "sync_paused" || error.code === "sync_generation_mismatch")
        ) {
          onAccountSyncPausedRef.current?.(error.syncGeneration);
        }
        writeDeviceSyncCycleRecords(
          upsertDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), {
            userScopeKey,
            lastAttemptAt: attemptAt,
            lastSuccessAt: record?.lastSuccessAt ?? null,
            lastErrorAt: new Date().toISOString(),
            consecutiveFailureCount: (record?.consecutiveFailureCount ?? 0) + 1,
            lastErrorCode,
            lastErrorHttpStatus: httpError?.status ?? null,
            lastErrorLockedReason: httpError?.lockedReason ?? null,
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
    [deviceLabelById.size, loadDeviceAccountState, refreshDeviceLabels, syncAccountId, userScopeKey],
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
