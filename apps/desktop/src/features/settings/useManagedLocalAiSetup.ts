import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  deleteManagedLocalAiModel,
  fallbackManagedLocalAiStatus,
  getManagedLocalAiStatus,
  installingManagedLocalAiStatus,
  installManagedLocalAiModel,
  listManagedLocalAiModels,
  MANAGED_LOCAL_AI_FALLBACK_CATALOG,
  type ManagedLocalAiModel,
  type ManagedLocalAiStatus,
} from "./managedLocalAiClient";
import { normalizeManagedLocalModelId, type LocalAiSetupState } from "./localAiSetup";

type ManagedLocalAiAction = (modelId: string) => Promise<ManagedLocalAiStatus>;
type SyncManagedSetupOptions = {
  readonly activateProvider: boolean;
};
type RunActionOptions = {
  readonly activateProvider: boolean;
  readonly optimisticInstalling: boolean;
};

export type UseManagedLocalAiSetupResult = {
  readonly actionModelId: string | null;
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly loading: boolean;
  readonly status: ManagedLocalAiStatus | null;
  readonly deleteModel: (modelId: string) => Promise<void>;
  readonly installModel: (modelId: string) => Promise<void>;
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
  const pendingReadyNotificationModelIdsRef = useRef(new Set<string>());

  const syncManagedSetup = useCallback((nextStatus: ManagedLocalAiStatus, options: SyncManagedSetupOptions) => {
    onLocalAiSetupChange((current) => ({
      ...current,
      provider: options.activateProvider ? "managed_local" : current.provider,
      driftyRoute: options.activateProvider ? "local" : current.driftyRoute,
      managedLocalModelId: normalizeManagedLocalModelId(nextStatus.selectedModelId ?? current.managedLocalModelId),
      managedLocalBaseUrl: nextStatus.baseUrl ?? current.managedLocalBaseUrl,
      managedLocalModel: nextStatus.model ?? current.managedLocalModel,
    }));
  }, [onLocalAiSetupChange]);

  const notifyReadyOnce = useCallback((nextStatus: ManagedLocalAiStatus) => {
    if (!isReadyManagedLocalAiStatus(nextStatus)) return;
    if (!pendingReadyNotificationModelIdsRef.current.has(nextStatus.selectedModelId)) return;
    pendingReadyNotificationModelIdsRef.current.delete(nextStatus.selectedModelId);
    const modelLabel = catalog.find((model) => model.id === nextStatus.selectedModelId)?.label ?? "Local AI model";
    void sendManagedLocalAiReadyNotification(modelLabel);
  }, [catalog]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextCatalog, nextStatus] = await Promise.all([
        listManagedLocalAiModels(),
        getManagedLocalAiStatus(),
      ]);
      if (!mountedRef.current) return;
      setCatalog(nextCatalog.length > 0 ? nextCatalog : MANAGED_LOCAL_AI_FALLBACK_CATALOG);
      setStatus(nextStatus);
      syncManagedSetup(nextStatus, { activateProvider: false });
    } catch (error) {
      if (!mountedRef.current) return;
      setCatalog(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
      setStatus(fallbackManagedLocalAiStatus(messageFromError(error)));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [syncManagedSetup]);

  const refreshStatusOnly = useCallback(async () => {
    try {
      const nextStatus = await getManagedLocalAiStatus();
      if (!mountedRef.current) return;
      setStatus(nextStatus);
      syncManagedSetup(nextStatus, { activateProvider: false });
      notifyReadyOnce(nextStatus);
    } catch (error) {
      if (error instanceof Error) return;
      throw error;
    }
  }, [notifyReadyOnce, syncManagedSetup]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

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
      const installingStatus = installingManagedLocalAiStatus(modelId);
      pendingReadyNotificationModelIdsRef.current.add(modelId);
      setStatus(installingStatus);
      syncManagedSetup(installingStatus, { activateProvider: options.activateProvider });
    }
    try {
      const nextStatus = await action(modelId);
      syncManagedSetup(nextStatus, { activateProvider: options.activateProvider });
      notifyReadyOnce(nextStatus);
      if (mountedRef.current) setStatus(nextStatus);
    } catch (error) {
      pendingReadyNotificationModelIdsRef.current.delete(modelId);
      if (mountedRef.current) setStatus(fallbackManagedLocalAiStatus(messageFromError(error)));
    } finally {
      if (mountedRef.current) setActionModelId(null);
    }
  }, [actionModelId, notifyReadyOnce, status?.state, syncManagedSetup]);

  return {
    actionModelId,
    catalog,
    loading,
    status,
    deleteModel: (modelId) => runAction(modelId, deleteManagedLocalAiModel, { activateProvider: false, optimisticInstalling: false }),
    installModel: (modelId) => runAction(modelId, installManagedLocalAiModel, { activateProvider: activateProviderOnInstall, optimisticInstalling: true }),
    refresh,
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Managed local AI is not available in this build.";
}

function isReadyManagedLocalAiStatus(status: ManagedLocalAiStatus): status is ManagedLocalAiStatus & {
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

async function sendManagedLocalAiReadyNotification(modelLabel: string): Promise<void> {
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
