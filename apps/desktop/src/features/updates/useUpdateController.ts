import { acquireUpdateOperation, readVersionTestPauseUntil, useVersionTestPauseUntil } from "./versionSwitchState";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { toErrorMessage } from "../../lib/formatting";
import {
  fallbackUpdatePolicy,
  fetchUpdatePolicy,
  clearPostUpdateRelaunchFocusPending,
  markUpdateBackgroundPreparationAttempted,
  markUpdateBackgroundPreparationFailed,
  markUpdateInteracted,
  markPostUpdateRelaunchFocusPending,
  msUntilAutomaticDialog,
  persistBackgroundUpdatesEnabled,
  persistUpdateInteractionMap,
  readUpdateInteractionMap,
  resolveInitialBackgroundUpdatesEnabled,
  shouldPrepareUpdateInBackground,
  shouldShowAutomaticUpdateDialog,
  upsertUpdateSeen,
  type UpdateInteractionMap,
  type UpdatePolicy,
} from "./updatePolicy";

type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;
export type UpdateCheckMode = "manual" | "automatic";

export const UPDATE_IDLE_RESTART_THRESHOLD_SECONDS = 15 * 60;
export const UPDATE_IDLE_RESTART_HIDDEN_THRESHOLD_SECONDS = 3 * 60;
export const UPDATE_IDLE_CHECK_INTERVAL_MS = 30 * 1000;

export type UpdateCheckResult =
  | { readonly kind: "available"; readonly version: string }
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly message: string };

export type UpdateLifecycleStatus = "idle" | "available" | "downloading" | "installing";

type UseUpdateControllerResult = {
  readonly backgroundUpdatesEnabled: boolean;
  readonly availableUpdate: AvailableUpdate | null;
  readonly availableUpdateSource: UpdateCheckMode | null;
  readonly currentUpdatePolicy: UpdatePolicy | null;
  readonly dismissAvailableUpdate: () => void;
  readonly handleCheckForUpdates: (mode?: UpdateCheckMode) => Promise<UpdateCheckResult | void>;
  readonly handleInstallUpdate: () => Promise<void>;
  readonly canAutoUpdateSilently: boolean;
  readonly preparedUpdateVersion: string | null;
  readonly setBackgroundUpdatesEnabled: (enabled: boolean) => void;
  readonly shouldShowAvailableUpdateDialog: boolean;
  readonly updateLifecycleStatus: UpdateLifecycleStatus;
  readonly updaterChecking: boolean;
  readonly updaterDownloading: boolean;
  /** 0..1 of the update payload transferred, or null when the size is unknown. */
  readonly updaterDownloadProgress: number | null;
  readonly updaterError: string | null;
  readonly updaterInstalling: boolean;
  readonly updaterMessage: string | null;
};

type UseUpdateControllerOptions = {
  readonly backgroundPreparationSupported: boolean;
  readonly getIdleSeconds?: () => Promise<number | null>;
  readonly canSafelyRestart?: () => boolean;
};

function releaseUpdateResource(update: AvailableUpdate | null): void {
  if (!update) return;
  void update.close().catch((error: unknown) => {
    console.warn(`Failed to release updater resource: ${toErrorMessage(error)}`);
  });
}

export function useUpdateController({
  backgroundPreparationSupported,
  getIdleSeconds,
  canSafelyRestart,
}: UseUpdateControllerOptions): UseUpdateControllerResult {
  const versionTestPauseUntil = useVersionTestPauseUntil();
  const updaterCheckingRef = useRef(false);
  const manualCheckRequestedRef = useRef(false);
  const updaterOperatingRef = useRef(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const availableUpdateRef = useRef<AvailableUpdate | null>(null);
  const [availableUpdateSource, setAvailableUpdateSource] = useState<UpdateCheckMode | null>(null);
  const [availableUpdatePolicy, setAvailableUpdatePolicy] = useState<UpdatePolicy | null>(null);
  const [dismissedPromptVersion, setDismissedPromptVersion] = useState<string | null>(null);
  const preparedUpdateVersionRef = useRef<string | null>(null);
  const [preparedUpdateVersion, setPreparedUpdateVersion] = useState<string | null>(null);
  const [updateInteractions, setUpdateInteractions] = useState<UpdateInteractionMap>(readUpdateInteractionMap);
  const updateInteractionsRef = useRef(updateInteractions);
  const [updatePromptNowMs, setUpdatePromptNowMs] = useState(() => Date.now());
  const [backgroundUpdatesEnabled, setBackgroundUpdatesEnabled] = useState(resolveInitialBackgroundUpdatesEnabled);
  const [updaterChecking, setUpdaterChecking] = useState(false);
  const [updaterDownloading, setUpdaterDownloading] = useState(false);
  const [updaterDownloadProgress, setUpdaterDownloadProgress] = useState<number | null>(null);
  const [updaterInstalling, setUpdaterInstalling] = useState(false);
  const [updaterMessage, setUpdaterMessage] = useState<string | null>(null);
  const [updaterError, setUpdaterError] = useState<string | null>(null);

  useEffect(() => {
    if (versionTestPauseUntil > Date.now()) setBackgroundUpdatesEnabled(false);
  }, [versionTestPauseUntil]);

  useEffect(() => {
    updateInteractionsRef.current = updateInteractions;
  }, [updateInteractions]);

  const updateStoredInteractions = useCallback((producer: (current: UpdateInteractionMap) => UpdateInteractionMap) => {
    const nextInteractions = producer(updateInteractionsRef.current);
    updateInteractionsRef.current = nextInteractions;
    setUpdateInteractions(nextInteractions);
    persistUpdateInteractionMap(nextInteractions);
    return nextInteractions;
  }, []);

  const replaceAvailableUpdate = useCallback((nextUpdate: AvailableUpdate | null) => {
    const previousUpdate = availableUpdateRef.current;
    availableUpdateRef.current = nextUpdate;
    setAvailableUpdate(nextUpdate);
    if (previousUpdate !== nextUpdate) releaseUpdateResource(previousUpdate);
  }, []);

  const rememberPreparedUpdate = useCallback((version: string | null) => {
    preparedUpdateVersionRef.current = version;
    setPreparedUpdateVersion(version);
  }, []);

  useEffect(() => () => {
    const currentUpdate = availableUpdateRef.current;
    availableUpdateRef.current = null;
    releaseUpdateResource(currentUpdate);
  }, []);

  const installUpdateAndRestart = useCallback(async (
    resolveUpdate: () => Promise<AvailableUpdate | null | undefined>,
  ) => {
    if (updaterOperatingRef.current) return;

    const releaseOperation = acquireUpdateOperation();
    if (!releaseOperation) return;
    updaterOperatingRef.current = true;
    setUpdaterInstalling(true);
    setUpdaterError(null);
    setUpdaterDownloadProgress(null);

    try {
      const updateToInstall = await resolveUpdate();
      if (!updateToInstall) return;
      // The updater already reports its transfer; ignoring it left the app
      // sitting on a disabled "Preparing" button for the whole download, which
      // is the moment people are most worried about an app that restarts itself.
      let contentLength = 0;
      let downloadedBytes = 0;
      await updateToInstall.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          // A source without a content length gets no invented percentage.
          setUpdaterDownloadProgress(contentLength > 0 ? 0 : null);
          return;
        }
        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (contentLength > 0) {
            setUpdaterDownloadProgress(Math.min(1, downloadedBytes / contentLength));
          }
          return;
        }
        // "Finished" covers the transfer only; installing continues after it.
        if (contentLength > 0) setUpdaterDownloadProgress(1);
      });
      markPostUpdateRelaunchFocusPending();
      await invoke<void>("app_restart_after_update");
    } catch (nextError) {
      clearPostUpdateRelaunchFocusPending();
      setUpdaterError(`Update install failed: ${toErrorMessage(nextError)}`);
    } finally {
      releaseOperation();
      updaterOperatingRef.current = false;
      setUpdaterInstalling(false);
      setUpdaterDownloadProgress(null);
    }
  }, []);

  const prepareUpdateInBackground = useCallback(async (
    updateToPrepare: AvailableUpdate,
    version: string,
  ): Promise<boolean> => {
    if (updaterOperatingRef.current) return false;

    if (readVersionTestPauseUntil() > Date.now()) return false;
    const releaseOperation = acquireUpdateOperation();
    if (!releaseOperation) return false;
    updaterOperatingRef.current = true;
    setUpdaterDownloading(true);
    setUpdaterError(null);
    setUpdaterMessage(`Preparing Drifty ${version} in the background...`);

    try {
      await updateToPrepare.download();
      setUpdaterDownloading(false);
      setUpdaterInstalling(true);
      await updateToPrepare.install();
      rememberPreparedUpdate(version);
      setUpdaterMessage(`Drifty ${version} is ready for the next launch.`);
      replaceAvailableUpdate(null);
      return true;
    } catch (nextError) {
      updateStoredInteractions((currentInteractions) => (
        markUpdateBackgroundPreparationFailed(currentInteractions, version)
      ));
      setUpdaterError(`Update preparation failed: ${toErrorMessage(nextError)}`);
      return false;
    } finally {
      releaseOperation();
      updaterOperatingRef.current = false;
      setUpdaterDownloading(false);
      setUpdaterInstalling(false);
    }
  }, [rememberPreparedUpdate, replaceAvailableUpdate, updateStoredInteractions]);

  const handleCheckForUpdates = useCallback(async (
    mode: UpdateCheckMode = "manual",
  ): Promise<UpdateCheckResult | void> => {
    if (updaterOperatingRef.current) return;
    if (mode === "automatic" && readVersionTestPauseUntil() > Date.now()) return;
    if (updaterCheckingRef.current) {
      // A click during the scheduled check upgrades that same request to a
      // visible manual result instead of silently discarding the user's action.
      if (mode === "manual") {
        manualCheckRequestedRef.current = true;
        setUpdaterChecking(true);
        setUpdaterMessage("Checking for updates...");
        setUpdaterError(null);
      }
      return;
    }

    manualCheckRequestedRef.current = mode === "manual";
    updaterCheckingRef.current = true;
    if (manualCheckRequestedRef.current) {
      setUpdaterChecking(true);
      setUpdaterMessage("Checking for updates...");
      setUpdaterError(null);
    }

    try {
      const nextUpdate = await check();
      if (!manualCheckRequestedRef.current && readVersionTestPauseUntil() > Date.now()) {
        releaseUpdateResource(nextUpdate);
        return;
      }
      if (nextUpdate) {
        if (preparedUpdateVersionRef.current === nextUpdate.version) {
          releaseUpdateResource(nextUpdate);
          if (manualCheckRequestedRef.current) setUpdaterMessage(`Drifty ${nextUpdate.version} is ready for the next launch.`);
          return { kind: "available", version: nextUpdate.version };
        }

        const nowMs = Date.now();
        const nextPolicy = await fetchUpdatePolicy(nextUpdate.version);
        if (!manualCheckRequestedRef.current && readVersionTestPauseUntil() > Date.now()) {
          releaseUpdateResource(nextUpdate);
          return;
        }
        const nextInteractions = updateStoredInteractions((currentInteractions) => {
          const seenInteractions = upsertUpdateSeen(currentInteractions, nextUpdate.version, nowMs);
          return manualCheckRequestedRef.current ? markUpdateInteracted(seenInteractions, nextUpdate.version, nowMs) : seenInteractions;
        });
        const nextInteraction = nextInteractions[nextUpdate.version] ?? null;
        replaceAvailableUpdate(nextUpdate);
        setAvailableUpdatePolicy(nextPolicy);
        setAvailableUpdateSource(manualCheckRequestedRef.current ? "manual" : "automatic");
        setDismissedPromptVersion(null);
        setUpdatePromptNowMs(nowMs);
        if (manualCheckRequestedRef.current) {
          setUpdaterMessage(`Drifty ${nextUpdate.version} is available.`);
        }
        if (!manualCheckRequestedRef.current && nextPolicy.urgency === "general" && shouldPrepareUpdateInBackground({
          backgroundPreparationSupported,
          backgroundUpdatesEnabled,
          policy: nextPolicy,
          interaction: nextInteraction,
        })) {
          updateStoredInteractions((currentInteractions) => markUpdateBackgroundPreparationAttempted(
            currentInteractions,
            nextUpdate.version,
            Date.now(),
          ));
          const prepared = await prepareUpdateInBackground(nextUpdate, nextUpdate.version);
          if (!prepared) {
            return { kind: "error", message: `Unable to prepare Drifty ${nextUpdate.version}.` };
          }
        }
        return { kind: "available", version: nextUpdate.version };
      }

      if (!preparedUpdateVersionRef.current) {
        replaceAvailableUpdate(null);
        setAvailableUpdatePolicy(null);
        setAvailableUpdateSource(null);
      }
      if (manualCheckRequestedRef.current) setUpdaterMessage("Drifty is up to date.");
      return { kind: "none" };
    } catch (nextError) {
      const message = `Update check failed: ${toErrorMessage(nextError)}`;
      if (manualCheckRequestedRef.current) {
        replaceAvailableUpdate(null);
        setAvailableUpdatePolicy(null);
        setAvailableUpdateSource(null);
        setUpdaterError(message);
      }
      return { kind: "error", message };
    } finally {
      updaterCheckingRef.current = false;
      if (manualCheckRequestedRef.current) setUpdaterChecking(false);
      manualCheckRequestedRef.current = false;
    }
  }, [
    backgroundPreparationSupported,
    backgroundUpdatesEnabled,
    prepareUpdateInBackground,
    replaceAvailableUpdate,
    updateStoredInteractions,
  ]);

  const handleInstallUpdate = useCallback(async () => {
    if (preparedUpdateVersionRef.current) {
      markPostUpdateRelaunchFocusPending();
      await invoke<void>("app_restart_after_update");
      return;
    }
    const offeredUpdate = availableUpdateRef.current;
    if (!offeredUpdate || updaterCheckingRef.current || updaterOperatingRef.current) return;

    setUpdaterMessage("Checking for the latest update...");
    await installUpdateAndRestart(async () => {
      const latestUpdate = await check();
      if (!latestUpdate) {
        replaceAvailableUpdate(null);
        setAvailableUpdatePolicy(null);
        setAvailableUpdateSource(null);
        setUpdaterMessage("Drifty is up to date.");
        return;
      }

      const nowMs = Date.now();
      const latestPolicy = latestUpdate.version === offeredUpdate.version
        && availableUpdatePolicy?.version === latestUpdate.version
        ? availableUpdatePolicy
        : await fetchUpdatePolicy(latestUpdate.version);
      replaceAvailableUpdate(latestUpdate);
      setAvailableUpdatePolicy(latestPolicy);
      // The user already chose to install. If installation fails, keep the
      // refreshed release in the quiet titlebar state instead of reopening a
      // stale or already-confirmed modal prompt.
      setAvailableUpdateSource("automatic");
      setDismissedPromptVersion(latestUpdate.version);
      setUpdatePromptNowMs(nowMs);
      updateStoredInteractions((currentInteractions) => markUpdateInteracted(
        upsertUpdateSeen(currentInteractions, latestUpdate.version, nowMs),
        latestUpdate.version,
        nowMs,
      ));
      setUpdaterMessage(`Installing Drifty ${latestUpdate.version}...`);
      return latestUpdate;
    });
  }, [
    availableUpdatePolicy,
    installUpdateAndRestart,
    replaceAvailableUpdate,
    updateStoredInteractions,
  ]);

  const dismissAvailableUpdate = useCallback(() => {
    const updateToDismiss = availableUpdateRef.current;
    if (!updateToDismiss) return;
    updateStoredInteractions((currentInteractions) => markUpdateInteracted(
      currentInteractions,
      updateToDismiss.version,
      Date.now(),
    ));
    setDismissedPromptVersion(updateToDismiss.version);
    setAvailableUpdateSource("automatic");
  }, [updateStoredInteractions]);

  const offeredUpdateVersion = availableUpdate?.version ?? null;
  const currentUpdatePolicy = offeredUpdateVersion
    ? availableUpdatePolicy ?? fallbackUpdatePolicy(offeredUpdateVersion)
    : null;
  const availableUpdateInteraction = offeredUpdateVersion ? updateInteractions[offeredUpdateVersion] ?? null : null;
  const shouldShowAvailableUpdateDialog = Boolean(
    availableUpdate
    && (availableUpdateSource === "manual" || versionTestPauseUntil <= Date.now())
    && currentUpdatePolicy
    && dismissedPromptVersion !== availableUpdate.version
    && (
      availableUpdateSource === "manual"
      || currentUpdatePolicy.urgency === "urgent"
      || (
        availableUpdateSource === "automatic"
        && (
          !backgroundUpdatesEnabled
          || !backgroundPreparationSupported
          || !currentUpdatePolicy.backgroundDownloadEligible
          || (availableUpdateInteraction?.backgroundPreparationFailureCount ?? 0) >= 3
        )
        && shouldShowAutomaticUpdateDialog({
          policy: currentUpdatePolicy,
          interaction: availableUpdateInteraction,
          nowMs: updatePromptNowMs,
        })
      )
    ),
  );

  useEffect(() => {
    persistBackgroundUpdatesEnabled(backgroundUpdatesEnabled);
  }, [backgroundUpdatesEnabled]);

  useEffect(() => {
    if (!offeredUpdateVersion || !currentUpdatePolicy || availableUpdateSource !== "automatic") return undefined;

    const remainingMs = msUntilAutomaticDialog({
      policy: currentUpdatePolicy,
      interaction: availableUpdateInteraction,
      nowMs: Date.now(),
    });
    if (remainingMs === null) return undefined;
    if (remainingMs <= 0) {
      setUpdatePromptNowMs(Date.now());
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setUpdatePromptNowMs(Date.now()), remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [availableUpdateInteraction, availableUpdateSource, currentUpdatePolicy, offeredUpdateVersion]);

  const updateLifecycleStatus: UpdateLifecycleStatus = updaterDownloading
    ? "downloading"
    : updaterInstalling
      ? "installing"
      : availableUpdate
          ? "available"
          : "idle";

  useEffect(() => {
    if (!preparedUpdateVersion) return undefined;
    if (!backgroundUpdatesEnabled) return undefined;
    if (!backgroundPreparationSupported) return undefined;

    let disposed = false;
    let restartInFlight = false;
    let hiddenSinceMs: number | null = typeof document !== "undefined" && document.visibilityState === "hidden"
      ? Date.now()
      : null;

    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        if (hiddenSinceMs === null) hiddenSinceMs = Date.now();
      } else {
        hiddenSinceMs = null;
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    const intervalId = window.setInterval(async () => {
      if (disposed || restartInFlight) return;
      if (updaterOperatingRef.current) return;
      if (canSafelyRestart && !canSafelyRestart()) return;

      const isHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      const idleSeconds = getIdleSeconds ? await getIdleSeconds().catch(() => null) : null;
      if (disposed || restartInFlight) return;

      let isSafeToRestart = false;
      if (idleSeconds !== null && Number.isFinite(idleSeconds)) {
        if (idleSeconds >= UPDATE_IDLE_RESTART_THRESHOLD_SECONDS) {
          isSafeToRestart = true;
        } else if (isHidden && idleSeconds >= UPDATE_IDLE_RESTART_HIDDEN_THRESHOLD_SECONDS) {
          isSafeToRestart = true;
        }
      } else if (isHidden && hiddenSinceMs !== null && Date.now() - hiddenSinceMs >= UPDATE_IDLE_RESTART_THRESHOLD_SECONDS * 1000) {
        isSafeToRestart = true;
      }

      if (!isSafeToRestart) return;

      const releaseOperation = acquireUpdateOperation();
      if (!releaseOperation) return;
      restartInFlight = true;
      try {
        if (!isHidden) {
          markPostUpdateRelaunchFocusPending();
        }
        await invoke<void>("app_restart_after_update");
      } catch (error) {
        console.warn("Failed to restart app after background update:", toErrorMessage(error));
        restartInFlight = false;
      } finally {
        releaseOperation();
      }
    }, UPDATE_IDLE_CHECK_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [
    backgroundPreparationSupported,
    backgroundUpdatesEnabled,
    canSafelyRestart,
    getIdleSeconds,
    preparedUpdateVersion,
  ]);

  const canAutoUpdateSilently = backgroundPreparationSupported
    && backgroundUpdatesEnabled
    && (preparedUpdateVersion !== null || (
      availableUpdateSource === "automatic"
      && currentUpdatePolicy?.urgency !== "urgent"
      && currentUpdatePolicy?.backgroundDownloadEligible === true
      && (availableUpdateInteraction?.backgroundPreparationFailureCount ?? 0) < 3
    ));

  return {
    backgroundUpdatesEnabled,
    availableUpdate,
    availableUpdateSource,
    canAutoUpdateSilently,
    currentUpdatePolicy,
    dismissAvailableUpdate,
    handleCheckForUpdates,
    handleInstallUpdate,
    preparedUpdateVersion,
    setBackgroundUpdatesEnabled,
    shouldShowAvailableUpdateDialog,
    updateLifecycleStatus,
    updaterChecking,
    updaterDownloading,
    updaterDownloadProgress,
    updaterError,
    updaterInstalling,
    updaterMessage,
  };
}
