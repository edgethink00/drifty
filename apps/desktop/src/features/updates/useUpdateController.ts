import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { toErrorMessage } from "../../lib/formatting";
import {
  fallbackUpdatePolicy,
  fetchUpdatePolicy,
  markUpdateAutoInstallAttempted,
  markUpdateInteracted,
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

type UseUpdateControllerResult = {
  readonly autoInstallFutureUpdates: boolean;
  readonly availableUpdate: AvailableUpdate | null;
  readonly currentUpdatePolicy: UpdatePolicy | null;
  readonly dismissAvailableUpdate: () => void;
  readonly handleCheckForUpdates: (mode?: UpdateCheckMode) => Promise<void>;
  readonly handleInstallUpdate: () => Promise<void>;
  readonly setAutoInstallFutureUpdates: (autoInstall: boolean) => void;
  readonly shouldShowAvailableUpdateDialog: boolean;
  readonly updaterChecking: boolean;
  readonly updaterError: string | null;
  readonly updaterInstalling: boolean;
  readonly updaterMessage: string | null;
};

export function useUpdateController(): UseUpdateControllerResult {
  const updaterCheckingRef = useRef(false);
  const updaterInstallingRef = useRef(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
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

  const installUpdate = useCallback(async (updateToInstall: AvailableUpdate) => {
    if (updaterInstallingRef.current) return;

    updaterInstallingRef.current = true;
    setUpdaterInstalling(true);
    setUpdaterError(null);

    try {
      await updateToInstall.downloadAndInstall();
      await relaunch();
    } catch (nextError) {
      setUpdaterError(`Update install failed: ${toErrorMessage(nextError)}`);
    } finally {
      updaterInstallingRef.current = false;
      setUpdaterInstalling(false);
    }
  }, []);

  const handleCheckForUpdates = useCallback(async (mode: UpdateCheckMode = "manual") => {
    if (updaterCheckingRef.current || updaterInstallingRef.current) return;

    const isManualCheck = mode === "manual";
    updaterCheckingRef.current = true;
    if (isManualCheck) {
      setUpdaterChecking(true);
      setUpdaterMessage(null);
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
        setAvailableUpdate(nextUpdate);
        setAvailableUpdatePolicy(nextPolicy);
        setAvailableUpdateSource(mode);
        setUpdatePromptNowMs(nowMs);
        if (!isManualCheck && shouldAutoInstallUpdate({
          autoInstallFutureUpdates,
          policy: nextPolicy,
          interaction: nextInteraction,
        })) {
          updateStoredInteractions((currentInteractions) => markUpdateAutoInstallAttempted(currentInteractions, nextUpdate.version, Date.now()));
          await installUpdate(nextUpdate);
        }
        return;
      }
      if (isManualCheck) {
        setAvailableUpdate(null);
        setAvailableUpdatePolicy(null);
        setAvailableUpdateSource(null);
        setUpdaterMessage("Drifty is up to date.");
      }
    } catch (nextError) {
      if (isManualCheck) {
        setAvailableUpdate(null);
        setAvailableUpdatePolicy(null);
        setAvailableUpdateSource(null);
        setUpdaterError(`Update check failed: ${toErrorMessage(nextError)}`);
      }
    } finally {
      updaterCheckingRef.current = false;
      if (isManualCheck) setUpdaterChecking(false);
    }
  }, [autoInstallFutureUpdates, installUpdate, updateStoredInteractions]);

  const handleInstallUpdate = useCallback(async () => {
    if (!availableUpdate) return;
    updateStoredInteractions((currentInteractions) => markUpdateInteracted(currentInteractions, availableUpdate.version, Date.now()));
    await installUpdate(availableUpdate);
  }, [availableUpdate, installUpdate, updateStoredInteractions]);

  const dismissAvailableUpdate = useCallback(() => {
    if (availableUpdate) {
      updateStoredInteractions((currentInteractions) => markUpdateInteracted(currentInteractions, availableUpdate.version, Date.now()));
    }
    setAvailableUpdate(null);
    setAvailableUpdatePolicy(null);
    setAvailableUpdateSource(null);
  }, [availableUpdate, updateStoredInteractions]);

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
