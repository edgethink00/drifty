import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";

import { cleanupTauriEventListener, type TauriEventUnlisten } from "../../lib/tauriEventCleanup";
import {
  deleteManagedLocalAiModel,
  fallbackManagedLocalAiStatus,
  getManagedLocalAiStatus,
  installingManagedLocalAiStatus,
  installManagedLocalAiModel,
  listManagedLocalAiModels,
  MANAGED_LOCAL_AI_FALLBACK_CATALOG,
  parseManagedLocalAiStatus,
  startManagedLocalAi,
  type ManagedLocalAiModel,
  type ManagedLocalAiStatus,
} from "./managedLocalAiClient";
import { normalizeManagedLocalModelId, type LocalAiSetupState } from "./localAiSetup";

type ManagedLocalAiAction = (modelId: string) => Promise<ManagedLocalAiStatus>;
type SyncManagedSetupOptions = {
  readonly activateProvider: boolean;
  readonly deletedModelId?: string;
};
type RunActionOptions = {
  readonly activateProvider: boolean;
  readonly optimisticInstalling: boolean;
  readonly deletedModelId?: string;
};

const MANAGED_LOCAL_AI_STATUS_EVENT = "managed-ai-status";


export type UseManagedLocalAiSetupResult = {
  readonly actionModelId: string | null;
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly loading: boolean;
  readonly status: ManagedLocalAiStatus | null;
  readonly deleteModel: (modelId: string) => Promise<void>;
  readonly installModel: (modelId: string) => Promise<void>;
  readonly startModel: (modelId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
};

export function useManagedLocalAiSetup(
  enabled: boolean,
  onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>,
  activateProviderOnInstall = false,
): UseManagedLocalAiSetupResult {
  const [catalog, setCatalog] = useState<readonly ManagedLocalAiModel[]>(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
  const [status, setStatus] = useState<ManagedLocalAiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionModelId, setActionModelId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const statusRequestRef = useRef(0);
  const pendingReadyNotificationModelIdsRef = useRef(new Set<string>());

  const syncManagedSetup = useCallback((nextStatus: ManagedLocalAiStatus, options: SyncManagedSetupOptions) => {
    onLocalAiSetupChange((current) => {
      const provider = options.activateProvider ? "managed_local" : current.provider;
      const driftyRoute = options.activateProvider ? "local" : current.driftyRoute;
      // The managedLocal* fields mean "this runtime setup is usable" — everything
      // downstream (classification options, the first-day gate's download wait)
      // treats their presence as model-ready. Rust reports base_url/model even in
      // download-progress statuses, so only a genuinely ready status may fill them.
      const runtimeReady = isReadyManagedLocalAiStatus(nextStatus);
      const managedLocalModelId = runtimeReady
        ? normalizeManagedLocalModelId(nextStatus.selectedModelId)
        : current.managedLocalModelId;
      const configuredModelDeleted = options.deletedModelId !== undefined
        && normalizeManagedLocalModelId(current.managedLocalModelId) === options.deletedModelId
        && nextStatus.state === "not_installed"
        && !nextStatus.installedModels.some((model) => model.id === options.deletedModelId);
      const managedLocalBaseUrl = runtimeReady ? nextStatus.baseUrl : configuredModelDeleted ? "" : current.managedLocalBaseUrl;
      const managedLocalModel = runtimeReady ? nextStatus.model : configuredModelDeleted ? "" : current.managedLocalModel;
      if (
        current.provider === provider
        && current.driftyRoute === driftyRoute
        && current.managedLocalModelId === managedLocalModelId
        && current.managedLocalBaseUrl === managedLocalBaseUrl
        && current.managedLocalModel === managedLocalModel
      ) {
        return current;
      }
      return {
        ...current,
        provider,
        driftyRoute,
        managedLocalModelId,
        managedLocalBaseUrl,
        managedLocalModel,
      };
    });
  }, [onLocalAiSetupChange]);

  const notifyReadyOnce = useCallback((nextStatus: ManagedLocalAiStatus) => {
    if (!isReadyManagedLocalAiStatus(nextStatus)) return;
    if (!pendingReadyNotificationModelIdsRef.current.has(nextStatus.selectedModelId)) return;
    pendingReadyNotificationModelIdsRef.current.delete(nextStatus.selectedModelId);
    const modelLabel = catalog.find((model) => model.id === nextStatus.selectedModelId)?.label ?? "Local AI model";
    void sendManagedLocalAiReadyNotification(modelLabel);
  }, [catalog]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      statusRequestRef.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    const statusRequest = statusRequestRef.current + 1;
    statusRequestRef.current = statusRequest;
    setLoading(true);
    void listManagedLocalAiModels()
      .then((nextCatalog) => {
        if (!mountedRef.current) return;
        setCatalog(nextCatalog.length > 0 ? nextCatalog : MANAGED_LOCAL_AI_FALLBACK_CATALOG);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setCatalog(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
      });
    try {
      const nextStatus = await getManagedLocalAiStatus();
      if (!mountedRef.current || statusRequest !== statusRequestRef.current) return;
      setStatus(nextStatus);
      syncManagedSetup(nextStatus, { activateProvider: false });
    } catch (error) {
      if (!mountedRef.current || statusRequest !== statusRequestRef.current) return;
      setCatalog(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
      setStatus(fallbackManagedLocalAiStatus(messageFromError(error)));
    } finally {
      if (mountedRef.current && statusRequest === statusRequestRef.current) setLoading(false);
    }
  }, [syncManagedSetup]);

  const refreshStatusOnly = useCallback(async () => {
    const statusRequest = statusRequestRef.current + 1;
    statusRequestRef.current = statusRequest;
    try {
      const nextStatus = await getManagedLocalAiStatus();
      if (!mountedRef.current || statusRequest !== statusRequestRef.current) return;
      // While an install is in flight, a poll can still report a *different*
      // (previously-loaded) model as "installed"/"running"; applying it would flash the
      // UI back to "ready" for the wrong model. Only statuses about a model we are
      // installing (or about no model at all) are applied.
      if (isStaleDifferentModelStatus(nextStatus, pendingReadyNotificationModelIdsRef.current)) return;
      setStatus(nextStatus);
      syncManagedSetup(nextStatus, { activateProvider: false });
      notifyReadyOnce(nextStatus);
    } catch {
      // Status polling is best-effort; the existing interval retries on its next tick.
      return;
    }
  }, [notifyReadyOnce, syncManagedSetup]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) return;
    let unlisten: TauriEventUnlisten | null = null;
    let cancelled = false;
    void listen<unknown>(MANAGED_LOCAL_AI_STATUS_EVENT, ({ payload }) => {
      if (cancelled || !mountedRef.current) return;
      const nextStatus = parseManagedLocalAiStatus(payload);
      // Native push is newer than every status request currently in flight.
      statusRequestRef.current += 1;
      setLoading(false);
      setStatus(nextStatus);
      syncManagedSetup(nextStatus, { activateProvider: false });
      notifyReadyOnce(nextStatus);
    }).then((nextUnlisten) => {
      if (cancelled) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [enabled, notifyReadyOnce, syncManagedSetup]);

  useEffect(() => {
    if (!enabled || (status?.state !== "installing" && status?.state !== "starting")) return;
    const intervalId = window.setInterval(() => {
      void refreshStatusOnly();
    }, 500);
    return () => window.clearInterval(intervalId);
  }, [enabled, refreshStatusOnly, status?.state]);

  const runAction = useCallback(async (modelId: string, action: ManagedLocalAiAction, options: RunActionOptions) => {
    if (actionModelId || status?.state === "installing" || status?.state === "starting") return;
    setActionModelId(modelId);
    if (options.optimisticInstalling) {
      const installingStatus = installingManagedLocalAiStatus(modelId, status?.installedModels ?? []);
      pendingReadyNotificationModelIdsRef.current.add(modelId);
      setStatus(installingStatus);
      syncManagedSetup(installingStatus, { activateProvider: options.activateProvider });
    }
    try {
      const nextStatus = await action(modelId);
      // When we optimistically showed "installing", ignore an action return that is about
      // a *different* (previously-loaded) model — it briefly reports that model as
      // "installed"/"running", which would flash the UI back to "ready", transiently
      // activate the wrong model id/base URL, and let the user advance mid-download.
      // A return about the model we're installing is applied as normal.
      if (!options.optimisticInstalling || nextStatus.selectedModelId === modelId) {
        syncManagedSetup(nextStatus, {
          activateProvider: options.activateProvider,
          ...(options.deletedModelId ? { deletedModelId: options.deletedModelId } : {}),
        });
        notifyReadyOnce(nextStatus);
        if (mountedRef.current) setStatus(nextStatus);
      }
    } catch (error) {
      pendingReadyNotificationModelIdsRef.current.delete(modelId);
      if (mountedRef.current) setStatus(fallbackManagedLocalAiStatus(messageFromError(error)));
    } finally {
      if (mountedRef.current) setActionModelId(null);
    }
  }, [actionModelId, notifyReadyOnce, status?.installedModels, status?.state, syncManagedSetup]);

  return {
    actionModelId,
    catalog,
    loading,
    status,
    deleteModel: (modelId) => runAction(modelId, deleteManagedLocalAiModel, { activateProvider: false, optimisticInstalling: false, deletedModelId: modelId }),
    installModel: (modelId) => runAction(modelId, installManagedLocalAiModel, { activateProvider: activateProviderOnInstall, optimisticInstalling: true }),
    startModel: (modelId) => runAction(modelId, startManagedLocalAi, { activateProvider: true, optimisticInstalling: false }),
    refresh,
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Managed local AI is not available in this build.";
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isStaleDifferentModelStatus(
  status: ManagedLocalAiStatus,
  pendingInstallModelIds: ReadonlySet<string>,
): boolean {
  if (pendingInstallModelIds.size === 0) return false;
  if (!status.selectedModelId) return false;
  return !pendingInstallModelIds.has(status.selectedModelId);
}

export function isReadyManagedLocalAiStatus(status: ManagedLocalAiStatus): status is ManagedLocalAiStatus & {
  readonly selectedModelId: string;
  readonly baseUrl: string;
  readonly model: string;
} {
  if (!status.selectedModelId || !status.baseUrl || !status.model) return false;
  switch (status.state) {
    case "installed":
    case "starting":
    case "running":
      return true;
    case "error":
    case "installing":
    case "not_installed":
      return false;
    default:
      return assertNeverManagedLocalAiState(status.state);
  }
}

export async function sendManagedLocalAiReadyNotification(modelLabel: string): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    sendNotification({
      title: "Local AI model ready",
      body: `${modelLabel} is ready for private classification.`,
    });
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
}

class ManagedLocalAiSetupStateError extends Error {
  constructor(readonly state: string) {
    super(`Unhandled managed local AI state: ${state}`);
    this.name = "ManagedLocalAiSetupStateError";
  }
}

function assertNeverManagedLocalAiState(value: never): never {
  throw new ManagedLocalAiSetupStateError(String(value));
}
