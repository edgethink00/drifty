import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  deleteManagedLocalAiModel,
  fallbackManagedLocalAiStatus,
  getManagedLocalAiStatus,
  installManagedLocalAiModel,
  listManagedLocalAiModels,
  MANAGED_LOCAL_AI_FALLBACK_CATALOG,
  startManagedLocalAi,
  type ManagedLocalAiModel,
  type ManagedLocalAiStatus,
} from "./managedLocalAiClient";
import { normalizeManagedLocalModelId, type LocalAiSetupState } from "./localAiSetup";

type ManagedLocalAiAction = (modelId: string) => Promise<ManagedLocalAiStatus>;

export type UseManagedLocalAiSetupResult = {
  readonly actionModelId: string | null;
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly loading: boolean;
  readonly status: ManagedLocalAiStatus | null;
  readonly deleteModel: (modelId: string) => Promise<void>;
  readonly installModel: (modelId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly startModel: (modelId: string) => Promise<void>;
};

export function useManagedLocalAiSetup(
  enabled: boolean,
  onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>,
): UseManagedLocalAiSetupResult {
  const [catalog, setCatalog] = useState<readonly ManagedLocalAiModel[]>(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
  const [status, setStatus] = useState<ManagedLocalAiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionModelId, setActionModelId] = useState<string | null>(null);

  const syncManagedSetup = useCallback((nextStatus: ManagedLocalAiStatus) => {
    onLocalAiSetupChange((current) => ({
      ...current,
      provider: "managed_local",
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
      syncManagedSetup(nextStatus);
    } catch (error) {
      setCatalog(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
      setStatus(fallbackManagedLocalAiStatus(messageFromError(error)));
    } finally {
      setLoading(false);
    }
  }, [syncManagedSetup]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const runAction = useCallback(async (modelId: string, action: ManagedLocalAiAction) => {
    if (actionModelId) return;
    setActionModelId(modelId);
    try {
      const nextStatus = await action(modelId);
      setStatus(nextStatus);
      syncManagedSetup(nextStatus);
    } catch (error) {
      setStatus(fallbackManagedLocalAiStatus(messageFromError(error)));
    } finally {
      setActionModelId(null);
    }
  }, [actionModelId, syncManagedSetup]);

  return {
    actionModelId,
    catalog,
    loading,
    status,
    deleteModel: (modelId) => runAction(modelId, deleteManagedLocalAiModel),
    installModel: (modelId) => runAction(modelId, installManagedLocalAiModel),
    refresh,
    startModel: (modelId) => runAction(modelId, startManagedLocalAi),
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Managed local AI is not available in this build.";
}
