import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { toErrorMessage } from "../../lib/formatting";
import {
  fallbackUpdatePolicy,
  fetchUpdatePolicy,
  clearPostUpdateRelaunchFocusPending,
  markUpdateAutoInstallAttempted,
  markUpdateInteracted,
  markPostUpdateRelaunchFocusPending,
  msUntilAutomaticDialog,
  persistAutoInstallFutureUpdates,
  persistUpdateInteractionMap,
  readUpdateInteractionMap,
  resolveInitialAutoInstallFutureUpdates,
  shouldAutoInstallUpdate,
  shouldShowAutomaticUpdateDialog,
  upsertUpdateSeen,
  type UpdateInteractionMap,
  type UpdatePolicy,
} from "./updatePolicy";

type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;
type UpdateCheckMode = "manual" | "automatic";

export type ManualUpdateCheckResult =
  | { readonly kind: "available"; readonly version: string }
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly message: string };

type UseUpdateControllerResult = {
  readonly autoInstallFutureUpdates: boolean;
  readonly availableUpdate: AvailableUpdate | null;
  readonly currentUpdatePolicy: UpdatePolicy | null;
  readonly dismissAvailableUpdate: () => void;
  readonly handleCheckForUpdates: (mode?: UpdateCheckMode) => Promise<ManualUpdateCheckResult | void>;
  readonly handleInstallUpdate: () => Promise<void>;
  readonly setAutoInstallFutureUpdates: (autoInstall: boolean) => void;
  readonly shouldShowAvailableUpdateDialog: boolean;
  readonly updaterChecking: boolean;
  readonly updaterError: string | null;
  readonly updaterInstalling: boolean;
  readonly updaterMessage: string | null;
};

function releaseUpdateResource(update: AvailableUpdate | null): void {
  if (!update) return;
  void update.close().catch((error: unknown) => {
    console.warn(`Failed to release updater resource: ${toErrorMessage(error)}`);
  });
}

export function useUpdateController(): UseUpdateControllerResult {
  const updaterCheckingRef = useRef(false);
  const updaterInstallingRef = useRef(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const availableUpdateRef = useRef<AvailableUpdate | null>(null);
  const [availableUpdateSource, setAvailableUpdateSource] = useState<UpdateCheckMode | null>(null);
  const [availableUpdatePolicy, setAvailableUpdatePolicy] = useState<UpdatePolicy | null>(null);
  const [updateInteractions, setUpdateInteractions] = useState<UpdateInteractionMap>(readUpdateInteractionMap);
  const updateInteractionsRef = useRef(updateInteractions);
  const [updatePromptNowMs, setUpdatePromptNowMs] = useState(() => Date.now());
  const [autoInstallFutureUpdates, setAutoInstallFutureUpdates] = useState(resolveInitialAutoInstallFutureUpdates);
  const [updaterChecking, setUpdaterChecking] = useState(false);
  const [updaterInstalling, setUpdaterInstalling] = useState(false);
  const [updaterMessage, setUpdaterMessage] = useState<string | null>(null);
  const [updaterError, setUpdaterError] = useState<string | null>(null);

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

  useEffect(() => () => {
    const currentUpdate = availableUpdateRef.current;
    availableUpdateRef.current = null;
    releaseUpdateResource(currentUpdate);
  }, []);

  const installUpdate = useCallback(async (resolveUpdate: () => Promise<AvailableUpdate | null | undefined>) => {
    if (updaterInstallingRef.current) return;

    updaterInstallingRef.current = true;
    setUpdaterInstalling(true);
    setUpdaterError(null);

    try {
      const updateToInstall = await resolveUpdate();
      if (!updateToInstall) return;
      await updateToInstall.downloadAndInstall();
      markPostUpdateRelaunchFocusPending();
      await invoke<void>("app_restart_after_update");
    } catch (nextError) {
      clearPostUpdateRelaunchFocusPending();
      setUpdaterError(`Update install failed: ${toErrorMessage(nextError)}`);
    } finally {
      updaterInstallingRef.current = false;
      setUpdaterInstalling(false);
    }
  }, []);

  const handleCheckForUpdates = useCallback(async (mode: UpdateCheckMode = "manual"): Promise<ManualUpdateCheckResult | void> => {
    if (updaterCheckingRef.current || updaterInstallingRef.current) return;

    const isManualCheck = mode === "manual";
    updaterCheckingRef.current = true;
    if (isManualCheck) {
      setUpdaterChecking(true);
      setUpdaterMessage("Checking for updates...");
      setUpdaterError(null);
    }

    try {
      const nextUpdate = await check();
      if (nextUpdate) {
        const nowMs = Date.now();
        const nextPolicy = await fetchUpdatePolicy(nextUpdate.version);
        const nextInteractions = updateStoredInteractions((currentInteractions) => {
          const seenInteractions = upsertUpdateSeen(currentInteractions, nextUpdate.version, nowMs);
          return isManualCheck ? markUpdateInteracted(seenInteractions, nextUpdate.version, nowMs) : seenInteractions;
        });
        const nextInteraction = nextInteractions[nextUpdate.version] ?? null;
        replaceAvailableUpdate(nextUpdate);
        setAvailableUpdatePolicy(nextPolicy);
        setAvailableUpdateSource(mode);
        setUpdatePromptNowMs(nowMs);
        if (isManualCheck) {
          setUpdaterMessage(`Drifty ${nextUpdate.version} is available.`);
        }
        if (!isManualCheck && shouldAutoInstallUpdate({
          autoInstallFutureUpdates,
          policy: nextPolicy,
          interaction: nextInteraction,
        })) {
          updateStoredInteractions((currentInteractions) => markUpdateAutoInstallAttempted(currentInteractions, nextUpdate.version, Date.now()));
          await installUpdate(async () => nextUpdate);
        }
        return isManualCheck ? { kind: "available", version: nextUpdate.version } : undefined;
      }
      if (isManualCheck) {
        replaceAvailableUpdate(null);
        setAvailableUpdatePolicy(null);
        setAvailableUpdateSource(null);
        setUpdaterMessage("Drifty is up to date.");
        return { kind: "none" };
      }
    } catch (nextError) {
      if (isManualCheck) {
        const message = `Update check failed: ${toErrorMessage(nextError)}`;
        replaceAvailableUpdate(null);
        setAvailableUpdatePolicy(null);
        setAvailableUpdateSource(null);
        setUpdaterError(message);
        return { kind: "error", message };
      }
    } finally {
      updaterCheckingRef.current = false;
      if (isManualCheck) setUpdaterChecking(false);
    }
  }, [autoInstallFutureUpdates, installUpdate, replaceAvailableUpdate, updateStoredInteractions]);

  const handleInstallUpdate = useCallback(async () => {
    const offeredUpdate = availableUpdateRef.current;
    if (!offeredUpdate || updaterCheckingRef.current || updaterInstallingRef.current) return;

    setUpdaterMessage("Checking for the latest update...");
    await installUpdate(async () => {
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
      setUpdatePromptNowMs(nowMs);
      updateStoredInteractions((currentInteractions) => markUpdateInteracted(
        upsertUpdateSeen(currentInteractions, latestUpdate.version, nowMs),
        latestUpdate.version,
        nowMs,
      ));
      setUpdaterMessage(`Installing Drifty ${latestUpdate.version}...`);
      return latestUpdate;
    });
  }, [availableUpdatePolicy, installUpdate, replaceAvailableUpdate, updateStoredInteractions]);

  const dismissAvailableUpdate = useCallback(() => {
    const updateToDismiss = availableUpdateRef.current;
    if (updateToDismiss) {
      updateStoredInteractions((currentInteractions) => markUpdateInteracted(currentInteractions, updateToDismiss.version, Date.now()));
    }
    replaceAvailableUpdate(null);
    setAvailableUpdatePolicy(null);
    setAvailableUpdateSource(null);
  }, [replaceAvailableUpdate, updateStoredInteractions]);

  const currentUpdatePolicy = availableUpdate ? availableUpdatePolicy ?? fallbackUpdatePolicy(availableUpdate.version) : null;
  const availableUpdateInteraction = availableUpdate ? updateInteractions[availableUpdate.version] ?? null : null;
  const shouldShowAvailableUpdateDialog = availableUpdate && currentUpdatePolicy
    ? availableUpdateSource === "manual"
      || (availableUpdateSource === "automatic" && shouldShowAutomaticUpdateDialog({
        policy: currentUpdatePolicy,
        interaction: availableUpdateInteraction,
        nowMs: updatePromptNowMs,
      }))
    : false;

  useEffect(() => {
    persistAutoInstallFutureUpdates(autoInstallFutureUpdates);
  }, [autoInstallFutureUpdates]);

  useEffect(() => {
    if (!availableUpdate || !currentUpdatePolicy || availableUpdateSource !== "automatic") return undefined;

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
  }, [availableUpdate, availableUpdateInteraction, availableUpdateSource, currentUpdatePolicy]);

  return {
    autoInstallFutureUpdates,
    availableUpdate,
    currentUpdatePolicy,
    dismissAvailableUpdate,
    handleCheckForUpdates,
    handleInstallUpdate,
    setAutoInstallFutureUpdates,
    shouldShowAvailableUpdateDialog,
    updaterChecking,
    updaterError,
    updaterInstalling,
    updaterMessage,
  };
}
