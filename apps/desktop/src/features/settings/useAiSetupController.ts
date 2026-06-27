import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { LocalAiProviderStatus } from "../ai-connection/AiConnectionStatusBar";
import {
  aiConnectionIssueKindFromMessage,
  localAiProviderLabel,
  localAiSetupFingerprint,
  type LocalAiConnectionCheck,
} from "../ai-connection/aiConnectionHealth";
import type { AiClassificationSummary } from "../classification/aiClassificationService";
import { localAiProviderConfigFromSetup } from "./localAiClassificationOptions";
import type { LocalAiClassificationOptions } from "./localAiClassificationOptions";
import { isActiveProviderTestable } from "./aiSetupProviderSelection";
import {
  isManagedLocalAiRoute,
  LOCAL_AI_SETUP_STORAGE_KEY,
  resolveInitialLocalAiSetup,
  toPersistedLocalAiSetup,
  type LocalAiSetupState,
} from "./localAiSetup";
import type { AiConnectionTestResult } from "./aiConnectionTest";
import { getManagedLocalAiStatus, type ManagedLocalAiStatus } from "./managedLocalAiClient";
import { useAiConnectionTestRunner, type UseAiConnectionTestRunnerResult } from "./useAiConnectionTestRunner";

const MANAGED_LOCAL_MEMORY_POLL_MS = 5_000;

type UseAiSetupControllerResult = {
  readonly aiConnectionTest: UseAiConnectionTestRunnerResult;
  readonly aiSetupDialogOpen: boolean;
  readonly localAiClassificationOptions: LocalAiClassificationOptions | null;
  readonly localAiConnectionFingerprint: string | null;
  readonly localAiConnectionProviderLabel: ReturnType<typeof localAiProviderLabel>;
  readonly localAiMemoryUsageBytes: number | null;
  readonly localAiProviderStatus: LocalAiProviderStatus;
  readonly localAiSetup: LocalAiSetupState;
  readonly recordLocalAiClassificationError: (message: string) => void;
  readonly recordLocalAiClassificationSummary: (summary: AiClassificationSummary) => void;
  readonly setAiSetupDialogOpen: Dispatch<SetStateAction<boolean>>;
  readonly setLocalAiSetup: Dispatch<SetStateAction<LocalAiSetupState>>;
};

export function useAiSetupController(): UseAiSetupControllerResult {
  const [localAiSetup, setLocalAiSetup] = useState<LocalAiSetupState>(resolveInitialLocalAiSetup);
  const [localAiConnectionCheck, setLocalAiConnectionCheck] = useState<LocalAiConnectionCheck | null>(null);
  const [localAiMemoryUsageBytes, setLocalAiMemoryUsageBytes] = useState<number | null>(null);
  const [aiSetupDialogOpen, setAiSetupDialogOpen] = useState(false);

  const localAiClassificationOptions = useMemo(() => localAiProviderConfigFromSetup(localAiSetup), [localAiSetup]);
  const localAiConnectionFingerprint = useMemo(() => localAiSetupFingerprint(localAiSetup), [localAiSetup]);
  const localAiConnectionProviderLabel = localAiProviderLabel(localAiSetup);

  const recordLocalAiConnectionTestResult = useCallback((testedSetup: LocalAiSetupState, result: AiConnectionTestResult) => {
    const fingerprint = localAiSetupFingerprint(testedSetup);
    if (!fingerprint) {
      setLocalAiConnectionCheck(null);
      return;
    }
    setLocalAiConnectionCheck({
      provider: testedSetup.provider,
      fingerprint,
      status: result.kind === "success" ? "connected" : "failed",
      issueKind: result.kind === "success" ? null : aiConnectionIssueKindFromMessage(result.message),
      message: result.message,
      checkedAt: Date.now(),
    });
  }, []);

  const aiConnectionTest = useAiConnectionTestRunner({
    localAiSetup,
    onLocalAiConnectionTestResult: recordLocalAiConnectionTestResult,
  });

  const localAiProviderStatus = useMemo<LocalAiProviderStatus>(() => {
    if (!localAiConnectionFingerprint) return { kind: "unconfigured" };
    if (aiConnectionTest.runningFingerprint === localAiConnectionFingerprint) return { kind: "checking" };

    const currentConnectionCheck = (
      localAiConnectionCheck
      && localAiConnectionCheck.provider === localAiSetup.provider
      && localAiConnectionCheck.fingerprint === localAiConnectionFingerprint
    )
      ? localAiConnectionCheck
      : null;
    if (!currentConnectionCheck) {
      return isActiveProviderTestable(localAiSetup) ? { kind: "checking" } : { kind: "unconfigured" };
    }
    if (currentConnectionCheck.status === "connected") return { kind: "connected" };
    return {
      kind: "failed",
      issueKind: currentConnectionCheck.issueKind ?? aiConnectionIssueKindFromMessage(currentConnectionCheck.message),
    };
  }, [aiConnectionTest.runningFingerprint, localAiConnectionCheck, localAiConnectionFingerprint, localAiSetup]);

  const recordLocalAiClassificationSummary = useCallback((summary: AiClassificationSummary) => {
    if (!localAiConnectionFingerprint) return;
    if (summary.status === "error") {
      setLocalAiConnectionCheck({
        provider: localAiSetup.provider,
        fingerprint: localAiConnectionFingerprint,
        status: "failed",
        issueKind: aiConnectionIssueKindFromMessage(summary.message),
        message: summary.message,
        checkedAt: Date.now(),
      });
      return;
    }
    if (summary.status !== "saved") return;
    setLocalAiConnectionCheck({
      provider: localAiSetup.provider,
      fingerprint: localAiConnectionFingerprint,
      status: "connected",
      issueKind: null,
      message: summary.message,
      checkedAt: Date.now(),
    });
  }, [localAiConnectionFingerprint, localAiSetup.provider]);

  const recordLocalAiClassificationError = useCallback((message: string) => {
    if (!localAiConnectionFingerprint) return;
    setLocalAiConnectionCheck({
      provider: localAiSetup.provider,
      fingerprint: localAiConnectionFingerprint,
      status: "failed",
      issueKind: aiConnectionIssueKindFromMessage(message),
      message,
      checkedAt: Date.now(),
    });
  }, [localAiConnectionFingerprint, localAiSetup.provider]);

  useEffect(() => {
    window.localStorage.setItem(LOCAL_AI_SETUP_STORAGE_KEY, JSON.stringify(toPersistedLocalAiSetup(localAiSetup)));
  }, [localAiSetup]);

  useEffect(() => {
    if (!localAiConnectionFingerprint || !isManagedLocalAiRoute(localAiSetup)) {
      setLocalAiMemoryUsageBytes(null);
      return;
    }

    let cancelled = false;
    const selectedModelId = localAiSetup.managedLocalModelId;
    const refreshMemoryUsage = async () => {
      try {
        const status = await getManagedLocalAiStatus();
        if (cancelled) return;
        setLocalAiMemoryUsageBytes(actualManagedLocalMemoryUsageBytes(status, selectedModelId));
      } catch (error) {
        if (error instanceof Error) {
          if (!cancelled) setLocalAiMemoryUsageBytes(null);
          return;
        }
        throw error;
      }
    };

    void refreshMemoryUsage();
    const intervalId = window.setInterval(() => {
      void refreshMemoryUsage();
    }, MANAGED_LOCAL_MEMORY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [localAiConnectionFingerprint, localAiSetup]);

  return {
    aiConnectionTest,
    aiSetupDialogOpen,
    localAiClassificationOptions,
    localAiConnectionFingerprint,
    localAiConnectionProviderLabel,
    localAiMemoryUsageBytes,
    localAiProviderStatus,
    localAiSetup,
    recordLocalAiClassificationError,
    recordLocalAiClassificationSummary,
    setAiSetupDialogOpen,
    setLocalAiSetup,
  };
}

function actualManagedLocalMemoryUsageBytes(status: ManagedLocalAiStatus, selectedModelId: string): number | null {
  if (status.selectedModelId !== selectedModelId) return null;
  switch (status.state) {
    case "running":
    case "starting":
      return status.memoryUsageBytes ?? null;
    case "error":
    case "installed":
    case "installing":
    case "not_installed":
      return null;
    default:
      return assertNeverManagedLocalAiState(status.state);
  }
}

class ManagedLocalAiMemoryStatusError extends Error {
  constructor(readonly state: string) {
    super(`Unhandled managed local AI memory state: ${state}`);
    this.name = "ManagedLocalAiMemoryStatusError";
  }
}

function assertNeverManagedLocalAiState(value: never): never {
  throw new ManagedLocalAiMemoryStatusError(String(value));
}
