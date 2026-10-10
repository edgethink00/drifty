import { acquireUpdateOperation, readVersionTestPauseUntil, UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY, useVersionTestPauseUntil } from "./versionSwitchState";
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
import { resolveUpdatePolicyFetch } from "./updatePolicyFetch";
import { WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY } from "./useAutomaticUpdateScheduler";
import { BUILD_INFO } from "../../buildInfo";
import { reportUpdateAppliedSinceLastRun, reportUpdateStep } from "./updateAnalytics";

type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;
export type UpdateCheckMode = "manual" | "automatic";

export const UPDATE_IDLE_RESTART_THRESHOLD_SECONDS = 15 * 60;
export const UPDATE_IDLE_RESTART_HIDDEN_THRESHOLD_SECONDS = 3 * 60;
export const UPDATE_IDLE_CHECK_INTERVAL_MS = 30 * 1000;
// ~10 minutes of unanswered idle probes before the prepared update falls back
// to normal prompting instead of waiting silently forever.
export const UPDATE_IDLE_PROBE_FAILURE_THRESHOLD = 20;
export const WINDOWS_INSTALL_ATTEMPT_STORAGE_KEY = "drifty.updates.windowsInstallAttempt.v1";

async function isUpdateWindowHidden(hostPlatform: "macos" | "windows" | "other"): Promise<boolean> {
  if (hostPlatform !== "windows") {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  }
  // WebView2 can report a visible document after the native window hides to
  // the tray. Only a native observation can admit the shorter idle threshold.
  try {
    const visible = await invoke<boolean>("plugin:window|is_visible", { label: "main" });
    if (visible === false) return true;
    if (visible !== true) return false;
    return await invoke<boolean>("plugin:window|is_minimized", { label: "main" }) === true;
  } catch {
    return false;
  }
}

function readFailedWindowsInstallVersion(): string | null {
  if (typeof window === "undefined") return null;
  const attemptedVersion = window.localStorage.getItem(WINDOWS_INSTALL_ATTEMPT_STORAGE_KEY);
  if (!attemptedVersion) return null;
  window.localStorage.removeItem(WINDOWS_INSTALL_ATTEMPT_STORAGE_KEY);
  return attemptedVersion === BUILD_INFO.version ? null : attemptedVersion;
}

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
  readonly hostPlatform?: "macos" | "windows" | "other";
  readonly stableAutomaticUpdatesEnabled?: boolean;
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
  hostPlatform = "other",
  stableAutomaticUpdatesEnabled = true,
  getIdleSeconds,
  canSafelyRestart,
}: UseUpdateControllerOptions): UseUpdateControllerResult {
  const getIdleSecondsRef = useRef(getIdleSeconds);
  const canSafelyRestartRef = useRef(canSafelyRestart);
  const stableAutomaticUpdatesEnabledRef = useRef(stableAutomaticUpdatesEnabled);
  const previousStableAutomaticUpdatesEnabledRef = useRef(stableAutomaticUpdatesEnabled);
  getIdleSecondsRef.current = getIdleSeconds;
  canSafelyRestartRef.current = canSafelyRestart;
  stableAutomaticUpdatesEnabledRef.current = stableAutomaticUpdatesEnabled;
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
  const [idleProbeFailures, setIdleProbeFailures] = useState(0);
  const [failedWindowsInstallVersion] = useState(readFailedWindowsInstallVersion);
  const failedWindowsInstallVersionRef = useRef(failedWindowsInstallVersion);

  useEffect(() => {
    if (hostPlatform === "windows" && failedWindowsInstallVersion) {
      setUpdaterError(`Drifty ${failedWindowsInstallVersion} could not finish installing. Install it manually.`);
    }
  }, [failedWindowsInstallVersion, hostPlatform]);

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

  const installPreparedWindowsUpdate = useCallback(async (version: string, silent: boolean) => {
    window.localStorage.setItem(WINDOWS_INSTALL_ATTEMPT_STORAGE_KEY, version);
    try {
      // The native updater owns signature-verified bytes and performs tracker
      // shutdown before launching NSIS. Success exits this process.
      await invoke<void>("windows_install_prepared_stable_update", { expectedVersion: version, silent });
    } catch (error) {
      window.localStorage.removeItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY);
      window.localStorage.setItem(UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY, "0");
      // Native installation may have stopped the tracker. Restarting restores
      // normal startup state; the old version then shows manual recovery.
      try {
        await invoke<void>("app_restart_after_update", { silent: false });
      } catch (restartError) {
        throw new Error(`${toErrorMessage(error)}; Drifty could not restart: ${toErrorMessage(restartError)}`);
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    const wasEnabled = previousStableAutomaticUpdatesEnabledRef.current;
    previousStableAutomaticUpdatesEnabledRef.current = stableAutomaticUpdatesEnabled;
    if (hostPlatform !== "windows" || !wasEnabled || stableAutomaticUpdatesEnabled || updaterOperatingRef.current) return;
    // Entering the Windows beta channel drops an uninstalled stable package.
    // Manual stable checks remain available even while Dev mode is enabled.
    rememberPreparedUpdate(null);
    replaceAvailableUpdate(null);
    setAvailableUpdatePolicy(null);
    setAvailableUpdateSource(null);
    window.localStorage.removeItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY);
    void invoke<void>("windows_clear_prepared_stable_update").catch((error: unknown) => {
      console.warn("Failed to clear the prepared Windows update:", toErrorMessage(error));
    });
  }, [hostPlatform, rememberPreparedUpdate, replaceAvailableUpdate, stableAutomaticUpdatesEnabled]);

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
      // macOS reports transfer progress. Windows uses the native signed
      // staging command and keeps the settings spinner until it completes.
      let contentLength = 0;
      let downloadedBytes = 0;
      if (hostPlatform === "windows") {
        await invoke<void>("windows_download_stable_update", { expectedVersion: updateToInstall.version });
        await installPreparedWindowsUpdate(updateToInstall.version, false);
      } else {
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
        await invoke<void>("app_restart_after_update", { silent: false });
      }
    } catch (nextError) {
      clearPostUpdateRelaunchFocusPending();
      reportUpdateStep("install_failed", { source: "manual", error: nextError });
      setUpdaterError(`Update install failed: ${toErrorMessage(nextError)}`);
    } finally {
      releaseOperation();
      updaterOperatingRef.current = false;
      setUpdaterInstalling(false);
      setUpdaterDownloadProgress(null);
    }
  }, [hostPlatform, installPreparedWindowsUpdate]);

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
      if (hostPlatform === "windows") {
        await invoke<void>("windows_download_stable_update", { expectedVersion: version });
      } else {
        await updateToPrepare.download();
      }
      setUpdaterDownloading(false);
      if (hostPlatform === "windows") {
        // Keep the native signed bytes until the idle gate, and recheck next
        // launch if the app quits naturally before that gate is reached.
        if (!stableAutomaticUpdatesEnabledRef.current) {
          replaceAvailableUpdate(null);
          await invoke<void>("windows_clear_prepared_stable_update");
          return false;
        }
        window.localStorage.setItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY, version);
        rememberPreparedUpdate(version);
        reportUpdateStep("prepared", { source: "automatic" });
        setUpdaterMessage(`Drifty ${version} will install when you're away.`);
        return true;
      }
      setUpdaterInstalling(true);
      await updateToPrepare.install();
      rememberPreparedUpdate(version);
      reportUpdateStep("prepared", { source: "automatic" });
      setUpdaterMessage(`Drifty ${version} is ready for the next launch.`);
      replaceAvailableUpdate(null);
      return true;
    } catch (nextError) {
      updateStoredInteractions((currentInteractions) => (
        markUpdateBackgroundPreparationFailed(currentInteractions, version)
      ));
      reportUpdateStep("prepare_failed", { source: "automatic", error: nextError });
      setUpdaterError(`Update preparation failed: ${toErrorMessage(nextError)}`);
      return false;
    } finally {
      releaseOperation();
      updaterOperatingRef.current = false;
      setUpdaterDownloading(false);
      setUpdaterInstalling(false);
    }
  }, [hostPlatform, rememberPreparedUpdate, replaceAvailableUpdate, updateStoredInteractions]);

  const handleCheckForUpdates = useCallback(async (
    mode: UpdateCheckMode = "manual",
  ): Promise<UpdateCheckResult | void> => {
    if (updaterOperatingRef.current) return;
    if (mode === "automatic" && (readVersionTestPauseUntil() > Date.now() || !stableAutomaticUpdatesEnabledRef.current)) return;
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
      if (!manualCheckRequestedRef.current && !stableAutomaticUpdatesEnabledRef.current) {
        releaseUpdateResource(nextUpdate);
        return;
      }
      if (!manualCheckRequestedRef.current && readVersionTestPauseUntil() > Date.now()) {
        releaseUpdateResource(nextUpdate);
        return;
      }
      if (nextUpdate) {
        if (preparedUpdateVersionRef.current === nextUpdate.version) {
          releaseUpdateResource(nextUpdate);
          if (manualCheckRequestedRef.current) setUpdaterMessage(hostPlatform === "windows"
            ? `Drifty ${nextUpdate.version} will install when you're away.`
            : `Drifty ${nextUpdate.version} is ready for the next launch.`);
          return { kind: "available", version: nextUpdate.version };
        }
        const pendingWindowsVersion = hostPlatform === "windows"
          ? window.localStorage.getItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY)
          : null;
        if (pendingWindowsVersion && pendingWindowsVersion !== nextUpdate.version) {
          window.localStorage.removeItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY);
        }
        if (hostPlatform === "windows" && preparedUpdateVersionRef.current) {
          rememberPreparedUpdate(null);
          window.localStorage.removeItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY);
          await invoke<void>("windows_clear_prepared_stable_update");
        }

        const nowMs = Date.now();
        const nextPolicy = await fetchUpdatePolicy(nextUpdate.version, resolveUpdatePolicyFetch(), hostPlatform);
        if (!manualCheckRequestedRef.current && !stableAutomaticUpdatesEnabledRef.current) {
          releaseUpdateResource(nextUpdate);
          return;
        }
        if (!manualCheckRequestedRef.current && readVersionTestPauseUntil() > Date.now()) {
          releaseUpdateResource(nextUpdate);
          return;
        }
        const nextInteractions = updateStoredInteractions((currentInteractions) => {
          const seenInteractions = upsertUpdateSeen(currentInteractions, nextUpdate.version, nowMs, BUILD_INFO.version);
          return manualCheckRequestedRef.current ? markUpdateInteracted(seenInteractions, nextUpdate.version, nowMs) : seenInteractions;
        });
        const nextInteraction = nextInteractions[nextUpdate.version] ?? null;
        reportUpdateStep("detected", {
          source: manualCheckRequestedRef.current ? "manual" : "automatic",
          backgroundUpdatesEnabled,
          backgroundEligible: backgroundPreparationSupported
            && nextPolicy.urgency === "general"
            && nextPolicy.installBehavior === (hostPlatform === "windows" ? "idle" : "next-launch")
            && nextPolicy.backgroundDownloadEligible,
        });
        replaceAvailableUpdate(nextUpdate);
        setAvailableUpdatePolicy(nextPolicy);
        const needsWindowsManualRecovery = hostPlatform === "windows"
          && failedWindowsInstallVersionRef.current === nextUpdate.version;
        setAvailableUpdateSource(manualCheckRequestedRef.current || needsWindowsManualRecovery ? "manual" : "automatic");
        setDismissedPromptVersion(null);
        setUpdatePromptNowMs(nowMs);
        if (manualCheckRequestedRef.current) {
          setUpdaterMessage(`Drifty ${nextUpdate.version} is available.`);
        }
        // A prepared Windows package lived only in the previous process. The
        // pending marker permits restaging that exact candidate after a normal
        // quit, while the policy and failure-count gates still apply.
        const restageLostWindowsPackage = pendingWindowsVersion === nextUpdate.version;
        if (!manualCheckRequestedRef.current && !needsWindowsManualRecovery && nextPolicy.urgency === "general"
          && nextPolicy.installBehavior === (hostPlatform === "windows" ? "idle" : "next-launch")
          && shouldPrepareUpdateInBackground({
          backgroundPreparationSupported,
          backgroundUpdatesEnabled,
          policy: nextPolicy,
          interaction: nextInteraction,
          allowPreviouslyAttempted: restageLostWindowsPackage,
        })) {
          updateStoredInteractions((currentInteractions) => markUpdateBackgroundPreparationAttempted(
            currentInteractions,
            nextUpdate.version,
            Date.now(),
          ));
          const prepared = await prepareUpdateInBackground(nextUpdate, nextUpdate.version);
          if (!prepared) {
            if (restageLostWindowsPackage) window.localStorage.removeItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY);
            return { kind: "error", message: `Unable to prepare Drifty ${nextUpdate.version}.` };
          }
        } else if (restageLostWindowsPackage) {
          window.localStorage.removeItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY);
        }
        return { kind: "available", version: nextUpdate.version };
      }

      if (hostPlatform === "windows" && preparedUpdateVersionRef.current) {
        rememberPreparedUpdate(null);
        await invoke<void>("windows_clear_prepared_stable_update");
      }
      if (!preparedUpdateVersionRef.current) {
        replaceAvailableUpdate(null);
        setAvailableUpdatePolicy(null);
        setAvailableUpdateSource(null);
      }
      if (hostPlatform === "windows") window.localStorage.removeItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY);
      if (manualCheckRequestedRef.current) setUpdaterMessage("Drifty is up to date.");
      return { kind: "none" };
    } catch (nextError) {
      const message = `Update check failed: ${toErrorMessage(nextError)}`;
      if (manualCheckRequestedRef.current) {
        // A failed recheck does not invalidate the signed Windows package.
        // Keep its candidate and policy so the idle installer can still run.
        if (hostPlatform !== "windows" || !preparedUpdateVersionRef.current) {
          replaceAvailableUpdate(null);
          setAvailableUpdatePolicy(null);
          setAvailableUpdateSource(null);
        }
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
    hostPlatform,
    prepareUpdateInBackground,
    rememberPreparedUpdate,
    replaceAvailableUpdate,
    updateStoredInteractions,
  ]);

  const handleInstallUpdate = useCallback(async () => {
    reportUpdateStep("install_requested", { source: availableUpdateSource ?? "manual" });
    if (preparedUpdateVersionRef.current) {
      if (hostPlatform === "windows") {
        const preparedVersion = preparedUpdateVersionRef.current;
        const releaseOperation = acquireUpdateOperation();
        if (!releaseOperation) return;
        updaterOperatingRef.current = true;
        setUpdaterInstalling(true);
        try {
          await installPreparedWindowsUpdate(preparedVersion, false);
        } catch (error) {
          setUpdaterError(`Update install failed: ${toErrorMessage(error)}`);
          reportUpdateStep("install_failed", { source: "manual", error });
          rememberPreparedUpdate(null);
          setAvailableUpdateSource("manual");
        } finally {
          updaterOperatingRef.current = false;
          setUpdaterInstalling(false);
          releaseOperation();
        }
        return;
      }
      markPostUpdateRelaunchFocusPending();
      await invoke<void>("app_restart_after_update", { silent: false });
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
        : await fetchUpdatePolicy(latestUpdate.version, resolveUpdatePolicyFetch(), hostPlatform);
      replaceAvailableUpdate(latestUpdate);
      setAvailableUpdatePolicy(latestPolicy);
      // The user already chose to install. If installation fails, keep the
      // refreshed release in the quiet titlebar state instead of reopening a
      // stale or already-confirmed modal prompt.
      setAvailableUpdateSource("automatic");
      setDismissedPromptVersion(latestUpdate.version);
      setUpdatePromptNowMs(nowMs);
      updateStoredInteractions((currentInteractions) => markUpdateInteracted(
        upsertUpdateSeen(currentInteractions, latestUpdate.version, nowMs, BUILD_INFO.version),
        latestUpdate.version,
        nowMs,
      ));
      setUpdaterMessage(`Installing Drifty ${latestUpdate.version}...`);
      return latestUpdate;
    });
  }, [
    availableUpdatePolicy,
    availableUpdateSource,
    hostPlatform,
    installUpdateAndRestart,
    installPreparedWindowsUpdate,
    rememberPreparedUpdate,
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
    reportUpdateStep("prompt_later", { source: availableUpdateSource ?? "automatic" });
  }, [availableUpdateSource, updateStoredInteractions]);

  const offeredUpdateVersion = availableUpdate?.version ?? null;
  const currentUpdatePolicy = offeredUpdateVersion
    ? availableUpdatePolicy ?? fallbackUpdatePolicy(offeredUpdateVersion)
    : null;
  const availableUpdateInteraction = offeredUpdateVersion ? updateInteractions[offeredUpdateVersion] ?? null : null;
  const idleProbeUnavailable = idleProbeFailures >= UPDATE_IDLE_PROBE_FAILURE_THRESHOLD;
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
          || idleProbeUnavailable
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
    const promptDue = () => {
      setUpdatePromptNowMs(Date.now());
      // An answer hides the prompt for the rest of the session. Drifty often
      // stays open for weeks, so once the reprompt wait has passed the same
      // session may ask again.
      setDismissedPromptVersion((dismissed) => (dismissed === offeredUpdateVersion ? null : dismissed));
    };
    if (remainingMs <= 0) {
      promptDue();
      return undefined;
    }

    const timeoutId = window.setTimeout(promptDue, remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [availableUpdateInteraction, availableUpdateSource, currentUpdatePolicy, offeredUpdateVersion]);

  useEffect(() => {
    if (!shouldShowAvailableUpdateDialog) return;
    reportUpdateStep("prompt_shown", { source: availableUpdateSource ?? "automatic" });
  }, [availableUpdateSource, offeredUpdateVersion, shouldShowAvailableUpdateDialog]);

  useEffect(() => {
    reportUpdateAppliedSinceLastRun();
  }, []);

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
    if (!backgroundPreparationSupported || !stableAutomaticUpdatesEnabled) return undefined;

    let disposed = false;
    let restartInFlight = false;
    let idleCheckInFlight = false;

    const intervalId = window.setInterval(() => {
      if (disposed || restartInFlight || idleCheckInFlight) return;
      if (updaterOperatingRef.current) return;
      const canRestart = canSafelyRestartRef.current;
      if (canRestart && !canRestart()) return;

      const getIdle = getIdleSecondsRef.current;
      idleCheckInFlight = true;
      void (async () => {
        try {
          const isHiddenBefore = await isUpdateWindowHidden(hostPlatform);
          const idleSeconds = getIdle ? await getIdle().catch(() => null) : null;
          if (disposed || restartInFlight) return;
          if (canSafelyRestartRef.current && !canSafelyRestartRef.current()) return;

          const isHiddenAfter = await isUpdateWindowHidden(hostPlatform);
          if (disposed || restartInFlight) return;
          if (canSafelyRestartRef.current && !canSafelyRestartRef.current()) return;
          let isSafeToRestart = false;
          if (idleSeconds !== null && Number.isFinite(idleSeconds)) {
            setIdleProbeFailures(0);
            if (idleSeconds >= UPDATE_IDLE_RESTART_THRESHOLD_SECONDS) {
              isSafeToRestart = true;
            } else if (isHiddenBefore && isHiddenAfter && idleSeconds >= UPDATE_IDLE_RESTART_HIDDEN_THRESHOLD_SECONDS) {
              isSafeToRestart = true;
            }
          } else {
            // While the silent path claims the update, both the dialog and the
            // titlebar badge stay hidden, so a probe that never answers would
            // strand the update with no user-visible path at all. Count the
            // unanswered probes so normal prompting eventually takes over.
            setIdleProbeFailures((count) => count + 1);
            return;
          }
          if (!isSafeToRestart) return;

          const releaseOperation = acquireUpdateOperation();
          if (!releaseOperation) return;
          restartInFlight = true;
          try {
            if (hostPlatform === "windows") {
              const prepared = availableUpdateRef.current;
              if (!prepared || prepared.version !== preparedUpdateVersionRef.current) {
                restartInFlight = false;
                return;
              }
              await installPreparedWindowsUpdate(prepared.version, true);
            } else {
              await invoke<void>("app_restart_after_update", { silent: true });
            }
          } catch (error) {
            console.warn("Failed to restart app after background update:", toErrorMessage(error));
            reportUpdateStep("install_failed", { source: "automatic", error });
            if (hostPlatform === "windows") {
              window.localStorage.removeItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY);
              rememberPreparedUpdate(null);
              updateStoredInteractions((interactions) => markUpdateBackgroundPreparationFailed(
                interactions,
                preparedUpdateVersion,
              ));
              setUpdaterError(`Update install failed: ${toErrorMessage(error)}`);
              setAvailableUpdateSource("manual");
            }
            restartInFlight = false;
          } finally {
            releaseOperation();
          }
        } finally {
          idleCheckInFlight = false;
        }
      })();
    }, UPDATE_IDLE_CHECK_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [
    backgroundPreparationSupported,
    backgroundUpdatesEnabled,
    hostPlatform,
    installPreparedWindowsUpdate,
    preparedUpdateVersion,
    rememberPreparedUpdate,
    stableAutomaticUpdatesEnabled,
    updateStoredInteractions,
  ]);

  const canAutoUpdateSilently = !idleProbeUnavailable
    // Dismissing recovery must leave the titlebar action reachable. This
    // version cannot use the silent path even after its source becomes automatic.
    && !(hostPlatform === "windows" && offeredUpdateVersion !== null
      && failedWindowsInstallVersion === offeredUpdateVersion)
    && backgroundPreparationSupported
    && backgroundUpdatesEnabled
    && stableAutomaticUpdatesEnabled
    && (preparedUpdateVersion !== null || (
      availableUpdateSource === "automatic"
      && currentUpdatePolicy?.urgency !== "urgent"
      && currentUpdatePolicy?.installBehavior === (hostPlatform === "windows" ? "idle" : "next-launch")
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
