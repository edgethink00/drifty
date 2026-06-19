import { useCallback, useEffect, useState } from "react";
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
): UseManagedLocalAiSetupResult {
  const [catalog, setCatalog] = useState<readonly ManagedLocalAiModel[]>(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
  const [status, setStatus] = useState<ManagedLocalAiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionModelId, setActionModelId] = useState<string | null>(null);

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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextCatalog, nextStatus] = await Promise.all([
        listManagedLocalAiModels(),
        getManagedLocalAiStatus(),
      ]);
      setCatalog(nextCatalog.length > 0 ? nextCatalog : MANAGED_LOCAL_AI_FALLBACK_CATALOG);
      setStatus(nextStatus);
      syncManagedSetup(nextStatus, { activateProvider: false });
    } catch (error) {
      setCatalog(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
      setStatus(fallbackManagedLocalAiStatus(messageFromError(error)));
    } finally {
      setLoading(false);
    }
  }, [syncManagedSetup]);

  const refreshStatusOnly = useCallback(async () => {
    try {
      const nextStatus = await getManagedLocalAiStatus();
      setStatus(nextStatus);
      syncManagedSetup(nextStatus, { activateProvider: false });
    } catch (error) {
      if (error instanceof Error) return;
      throw error;
    }
  }, [syncManagedSetup]);

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
      setStatus(installingManagedLocalAiStatus(modelId, status?.installedModels ?? []));
    }
    try {
      const nextStatus = await action(modelId);
      setStatus(nextStatus);
      syncManagedSetup(nextStatus, { activateProvider: options.activateProvider });
    } catch (error) {
      setStatus(fallbackManagedLocalAiStatus(messageFromError(error)));
    } finally {
      setActionModelId(null);
    }
  }, [actionModelId, status?.installedModels, status?.state, syncManagedSetup]);

  return {
    actionModelId,
    catalog,
    loading,
    status,
    deleteModel: (modelId) => runAction(modelId, deleteManagedLocalAiModel, { activateProvider: false, optimisticInstalling: false }),
    installModel: (modelId) => runAction(modelId, installManagedLocalAiModel, { activateProvider: false, optimisticInstalling: true }),
    refresh,
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Managed local AI is not available in this build.";
}
