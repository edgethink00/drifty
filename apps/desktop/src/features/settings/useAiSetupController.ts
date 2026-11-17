import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { LocalAiProviderStatus } from "../ai-connection/AiConnectionStatusBar";
import {
  aiConnectionIssueKindFromMessage,
  isEstablishedLocalAiDisconnect,
  localAiProviderLabel,
  localAiSetupFingerprint,
  nextLocalAiConnectionCheck,
  type LocalAiConnectionCheck,
  type LocalAiConnectionEvent,
} from "../ai-connection/aiConnectionHealth";
import type { AiClassificationSummary } from "../classification/aiClassificationService";
import type { EndpointFailureDetail } from "../ai-connection/endpointFailure";
import {
  failureSuggestsWrongAddress,
  findWorkingEndpointAddress,
  readAddressRepairNotice,
  recordDeclinedAddressRepair,
  writeAddressRepairNotice,
  type CustomEndpointAddressRepair,
} from "../ai-connection/customEndpointAddressRepair";
import { testLocalAiConnection } from "./aiConnectionTest";
import { listOpenAiCompatibleModels } from "./openAiCompatibleModels";
import type { LocalAiClassificationFailure } from "../classification/localAiClassificationFailure";
import { localAiProviderConfigFromSetup } from "./localAiClassificationOptions";
import type { LocalAiClassificationOptions } from "./localAiClassificationOptions";
import { isActiveProviderTestable } from "./aiSetupProviderSelection";
import {
  DEFAULT_LOCAL_AI_SETUP,
  isManagedLocalAiRoute,
  LOCAL_AI_SETUP_STORAGE_KEY,
  resolveInitialLocalAiSetup,
  toPersistedLocalAiSetup,
  type LocalAiSetupState,
  type PersistedLocalAiSetupState,
} from "./localAiSetup";
import type { AiConnectionTestResult } from "./aiConnectionTest";
import { resolveInitialAnalysisAiSetup } from "./analysisModelSetup";
import { loadCustomEndpointApiKey, saveCustomEndpointApiKey, recoverCustomEndpointApiKey } from "./customEndpointApiKeyStore";
import { getManagedLocalAiStatus, type ManagedLocalAiStatus } from "./managedLocalAiClient";
import { loadOpenRouterApiKey, saveOpenRouterApiKey, recoverOpenRouterApiKey } from "./openRouterApiKeyStore";
import { isPreviewAiMockBaseUrl, PREVIEW_AI_MOCK_BASE_URL, PREVIEW_AI_MOCK_MODELS } from "./previewAiContract";
import { useAiConnectionTestRunner, type UseAiConnectionTestRunnerResult } from "./useAiConnectionTestRunner";
import { useDirectAnalysisKeys } from "./useDirectAnalysisKeys";
import { useProviderKeyPersistence, type ProviderCredentialRecoveries } from "./useProviderKeyPersistence";

const MANAGED_LOCAL_MEMORY_POLL_MS = 5_000;
const readOpenRouterKey = () => loadOpenRouterApiKey({ throwOnError: true });
const readCustomEndpointKey = () => loadCustomEndpointApiKey({ throwOnError: true });
// Automatic recovery probe while the provider check is failed: back off
// 30s → 1m → 2m → 4m, capped at 5 minutes between attempts. Each probe is a
// single ~1-token chat completion, so even a day-long outage stays negligible.
const AI_CONNECTION_RETEST_BASE_DELAY_MS = 30_000;
const AI_CONNECTION_RETEST_MAX_DELAY_MS = 5 * 60_000;

type UseAiSetupControllerResult = {
  readonly aiConnectionTest: UseAiConnectionTestRunnerResult;
  readonly providerCredentials: ProviderCredentialRecoveries;
  readonly openRouterCredentialState: import("./intelligenceRouting").AnalysisCredentialState;
  readonly retryOpenRouterKeyRead: () => void;
  readonly customEndpointCredentialState: import("./intelligenceRouting").AnalysisCredentialState;
  readonly retryCustomEndpointKeyRead: () => void;
  readonly aiSetupDialogOpen: boolean;
  readonly localAiClassificationOptions: LocalAiClassificationOptions | null;
  readonly localAiConnectionFingerprint: string | null;
  /** Consecutive failures for the current provider fingerprint, including the quiet first failure. */
  readonly localAiConnectionFailureCount: number;
  /** What the endpoint did on the current failed connection test, when the failure came from one. */
  readonly localAiConnectionFailureDetail: EndpointFailureDetail | null;
  /** The custom endpoint address Drifty last repaired, until undone, dismissed or edited. */
  readonly customEndpointAddressRepair: CustomEndpointAddressRepair | null;
  /** Records a repair already applied by the settings panel (Fetch models). */
  readonly recordCustomEndpointAddressRepair: (from: string, to: string) => void;
  readonly undoCustomEndpointAddressRepair: () => void;
  readonly dismissCustomEndpointAddressRepair: () => void;
  readonly localAiConnectionProviderLabel: ReturnType<typeof localAiProviderLabel>;
  /** True once the failure is confirmed by repeated probes — gates chrome/status disconnect surfaces. */
  readonly localAiConnectionPersistentFailure: boolean;
  readonly localAiMemoryUsageBytes: number | null;
  readonly localAiProviderStatus: LocalAiProviderStatus;
  readonly localAiSetup: LocalAiSetupState;
  /** OpenAI and Anthropic keys, shared by the connection and any saved project/title model. */
  readonly directKeys: ReturnType<typeof useDirectAnalysisKeys>;
  readonly recordLocalAiClassificationError: (failure: LocalAiClassificationFailure) => void;
  readonly recordLocalAiClassificationSummary: (summary: AiClassificationSummary) => void;
  readonly setAiSetupDialogOpen: Dispatch<SetStateAction<boolean>>;
  readonly setLocalAiSetup: Dispatch<SetStateAction<LocalAiSetupState>>;
};

export function useAiSetupController(): UseAiSetupControllerResult {
  const [storedLocalAiSetup, setLocalAiSetup] = useState<LocalAiSetupState>(resolvePreviewAwareInitialLocalAiSetup);
  // Direct provider keys live in the OS credential store behind one shared hook, so
  // the connection and a saved project/title model always see the same key.
  const directKeys = useDirectAnalysisKeys();
  const localAiSetup = useMemo<LocalAiSetupState>(
    () => ({ ...storedLocalAiSetup, openaiApiKey: directKeys.keys.openai, anthropicApiKey: directKeys.keys.anthropic }),
    [storedLocalAiSetup, directKeys.keys.openai, directKeys.keys.anthropic],
  );
  const directProvider = localAiSetup.provider === "openai" || localAiSetup.provider === "anthropic" ? localAiSetup.provider : null;
  const directKeyLoad = directKeys.load;
  useEffect(() => {
    if (directProvider) void directKeyLoad(directProvider);
  }, [directProvider, directKeyLoad]);
  const directKeyPending = directProvider !== null && (directKeys.states[directProvider] === "idle" || directKeys.states[directProvider] === "loading");
  const [localAiConnectionCheck, setLocalAiConnectionCheck] = useState<LocalAiConnectionCheck | null>(null);
  const [localAiMemoryUsageBytes, setLocalAiMemoryUsageBytes] = useState<number | null>(null);
  const [aiSetupDialogOpen, setAiSetupDialogOpen] = useState(false);
  const restoreOpenRouterKey = useCallback((value: string, previous: string) => {
    setLocalAiSetup(current => current.openRouterApiKey.trim() === previous
      ? { ...current, openRouterApiKey: value } : current);
  }, []);
  const restoreCustomEndpointKey = useCallback((value: string, previous: string) => {
    setLocalAiSetup(current => current.selfHostedApiKey.trim() === previous
      ? { ...current, selfHostedApiKey: value } : current);
  }, []);
  // An explicit Intelligence override also needs its shared key after restart.
  const [analysisCredentialProvider] = useState(() => {
    const saved = resolveInitialAnalysisAiSetup();
    return saved.selectionSource !== "automatic" ? saved.provider : null;
  });
  // Local-mode launches stay Keychain-free. An explicit edit can still save
  // before provider selection (onboarding shares this controller).
  const openRouterCredential = useProviderKeyPersistence({
    enabled: localAiSetup.provider === "openrouter_byok" || analysisCredentialProvider === "openrouter" || aiSetupDialogOpen,
    value: localAiSetup.openRouterApiKey.trim(),
    load: readOpenRouterKey,
    save: saveOpenRouterApiKey,
    recoverNative: recoverOpenRouterApiKey,
    restore: restoreOpenRouterKey,
  });
  const customEndpointCredential = useProviderKeyPersistence({
    enabled: localAiSetup.provider === "self_hosted" || analysisCredentialProvider === "self_hosted" || aiSetupDialogOpen,
    value: localAiSetup.selfHostedApiKey.trim(),
    load: readCustomEndpointKey,
    save: saveCustomEndpointApiKey,
    recoverNative: recoverCustomEndpointApiKey,
    restore: restoreCustomEndpointKey,
  });
  const customEndpointCredentialState = customEndpointCredential.state;
  const retryCustomEndpointKeyRead = customEndpointCredential.retry;

  const localAiRetryAfterMsRef = useRef<number | null>(null);

  const localAiClassificationOptions = useMemo(() => localAiProviderConfigFromSetup(localAiSetup), [localAiSetup]);
  const localAiConnectionFingerprint = useMemo(() => localAiSetupFingerprint(localAiSetup), [localAiSetup]);
  const localAiConnectionProviderLabel = localAiProviderLabel(localAiSetup);
  const latestLocalAiSetupRef = useRef(localAiSetup);
  latestLocalAiSetupRef.current = localAiSetup;
  const [customEndpointAddressRepair, setCustomEndpointAddressRepair] = useState<CustomEndpointAddressRepair | null>(readAddressRepairNotice);
  const addressRepairInFlightRef = useRef<string | null>(null);
  // One repair attempt per address, model and key while the app runs: a
  // candidate that failed stays failed until the person changes something, so
  // repeated failing tests do not keep sending extra probes.
  const attemptedAddressRepairsRef = useRef(new Set<string>());

  const recordCustomEndpointAddressRepair = useCallback((from: string, to: string) => {
    const notice = { from, to };
    setCustomEndpointAddressRepair(notice);
    writeAddressRepairNotice(notice);
  }, []);

  const dismissCustomEndpointAddressRepair = useCallback(() => {
    setCustomEndpointAddressRepair(null);
    writeAddressRepairNotice(null);
  }, []);

  const undoCustomEndpointAddressRepair = useCallback(() => {
    const notice = customEndpointAddressRepair;
    if (!notice) return;
    // Never repair the restored address again: the person chose it.
    recordDeclinedAddressRepair(notice.from);
    setLocalAiSetup((current) => current.selfHostedBaseUrl === notice.to ? { ...current, selfHostedBaseUrl: notice.from } : current);
    dismissCustomEndpointAddressRepair();
  }, [customEndpointAddressRepair, dismissCustomEndpointAddressRepair]);

  // An edit to the base URL replaces the repaired address, so its notice ends.
  useEffect(() => {
    if (customEndpointAddressRepair && localAiSetup.selfHostedBaseUrl !== customEndpointAddressRepair.to) {
      dismissCustomEndpointAddressRepair();
    }
  }, [customEndpointAddressRepair, dismissCustomEndpointAddressRepair, localAiSetup.selfHostedBaseUrl]);

  /**
   * After a custom endpoint answered like a wrong address (a web page, a
   * non-JSON body, 404/405), try the same server's likely API address. Switch
   * only when it lists models and passes a real connection test with the
   * selected model, and only while the settings are still the ones tested.
   */
  const repairCustomEndpointAddress = useCallback(async (testedSetup: LocalAiSetupState) => {
    const from = testedSetup.selfHostedBaseUrl;
    const attemptKey = [from, testedSetup.selfHostedModel, testedSetup.selfHostedApiKey].join("\u0000");
    if (addressRepairInFlightRef.current === from || attemptedAddressRepairsRef.current.has(attemptKey)) return;
    attemptedAddressRepairsRef.current.add(attemptKey);
    addressRepairInFlightRef.current = from;
    const stillTested = () => {
      const current = latestLocalAiSetupRef.current;
      return current.provider === "self_hosted"
        && current.selfHostedBaseUrl === from
        && current.selfHostedModel === testedSetup.selfHostedModel
        && current.selfHostedApiKey === testedSetup.selfHostedApiKey;
    };
    try {
      const to = await findWorkingEndpointAddress(from, {
        listModels: (candidate) => listOpenAiCompatibleModels(candidate, testedSetup.selfHostedApiKey),
        confirm: async (candidate) => stillTested()
          && (await testLocalAiConnection({ ...testedSetup, selfHostedBaseUrl: candidate }, stillTested)).kind === "success",
      });
      if (!to || !stillTested()) return;
      setLocalAiSetup((current) => current.provider === "self_hosted" && current.selfHostedBaseUrl === from
        ? { ...current, selfHostedBaseUrl: to }
        : current);
      recordCustomEndpointAddressRepair(from, to);
    } finally {
      if (addressRepairInFlightRef.current === from) addressRepairInFlightRef.current = null;
    }
  }, [recordCustomEndpointAddressRepair]);

  const applyLocalAiConnectionEvent = useCallback((provider: LocalAiSetupState["provider"], fingerprint: string, event: LocalAiConnectionEvent) => {
    setLocalAiConnectionCheck((previous) => nextLocalAiConnectionCheck(previous, { provider, fingerprint }, event, Date.now()));
  }, []);

  const recordLocalAiConnectionTestResult = useCallback((testedSetup: LocalAiSetupState, result: AiConnectionTestResult) => {
    const fingerprint = localAiSetupFingerprint(testedSetup);
    if (!fingerprint) {
      localAiRetryAfterMsRef.current = null;
      setLocalAiConnectionCheck(null);
      return;
    }
    localAiRetryAfterMsRef.current = result.kind === "error" ? result.retryAfterMs ?? null : null;
    applyLocalAiConnectionEvent(testedSetup.provider, fingerprint, result.kind === "success"
      ? { kind: "connection_test_success", message: result.message }
      : { kind: "connection_test_failure", issueKind: result.issueKind, message: result.message, ...(result.detail ? { detail: result.detail } : {}) });
    if (testedSetup.provider === "self_hosted" && result.kind === "error" && failureSuggestsWrongAddress(result.detail)) {
      void repairCustomEndpointAddress(testedSetup);
    }
  }, [applyLocalAiConnectionEvent, repairCustomEndpointAddress]);

  const aiConnectionTest = useAiConnectionTestRunner({
    localAiSetup,
    onLocalAiConnectionTestResult: recordLocalAiConnectionTestResult,
    // Probing a key-protected custom endpoint before its stored key is restored
    // would log a spurious 401 on every launch.
    autoTestPaused: (localAiSetup.provider === "self_hosted" && !customEndpointCredential.loaded)
      || (localAiSetup.provider === "openrouter_byok" && !openRouterCredential.loaded) || directKeyPending,
  });

  const currentLocalAiConnectionCheck = useMemo(() => (
    localAiConnectionCheck
    && localAiConnectionCheck.provider === localAiSetup.provider
    && localAiConnectionCheck.fingerprint === localAiConnectionFingerprint
  )
    ? localAiConnectionCheck
    : null, [localAiConnectionCheck, localAiConnectionFingerprint, localAiSetup.provider]);

  const localAiProviderStatus = useMemo<LocalAiProviderStatus>(() => {
    if (!localAiConnectionFingerprint) return { kind: "unconfigured" };
    if (aiConnectionTest.runningFingerprint === localAiConnectionFingerprint) return { kind: "checking" };

    if (!currentLocalAiConnectionCheck) {
      return isActiveProviderTestable(localAiSetup) ? { kind: "checking" } : { kind: "unconfigured" };
    }
    if (currentLocalAiConnectionCheck.status === "connected") return { kind: "connected" };
    return {
      kind: "failed",
      issueKind: currentLocalAiConnectionCheck.issueKind ?? aiConnectionIssueKindFromMessage(currentLocalAiConnectionCheck.message),
    };
  }, [aiConnectionTest.runningFingerprint, currentLocalAiConnectionCheck, localAiConnectionFingerprint, localAiSetup]);

  const localAiConnectionPersistentFailure = isEstablishedLocalAiDisconnect(currentLocalAiConnectionCheck);
  const localAiConnectionFailureCount = currentLocalAiConnectionCheck?.consecutiveFailures ?? 0;
  const localAiConnectionFailureDetail = currentLocalAiConnectionCheck?.status === "failed"
    ? currentLocalAiConnectionCheck.failureDetail ?? null
    : null;

  const recordLocalAiClassificationSummary = useCallback((summary: AiClassificationSummary) => {
    if (!localAiConnectionFingerprint) return;
    if (summary.status === "error") {
      if (summary.failureKind === "content") {
        // Content-level failures mean the provider answered — proof the
        // connection works even though the run produced nothing usable. But
        // only when a round-trip actually happened: aggregated runs can end
        // content-tagged without ever reaching the provider.
        if (summary.usedAiProvider !== true) return;
        applyLocalAiConnectionEvent(localAiSetup.provider, localAiConnectionFingerprint, {
          kind: "provider_contact_ok",
          message: summary.message,
        });
        return;
      }
      applyLocalAiConnectionEvent(localAiSetup.provider, localAiConnectionFingerprint, {
        kind: "classification_failure",
        message: summary.message,
      });
      return;
    }
    if (summary.status !== "saved") return;
    // A run satisfied by deterministic rules or reused classifications never
    // reached the provider, so it is no evidence of connectivity either way.
    if (summary.usedAiProvider !== true) return;
    applyLocalAiConnectionEvent(localAiSetup.provider, localAiConnectionFingerprint, {
      kind: "provider_contact_ok",
      message: summary.message,
    });
  }, [applyLocalAiConnectionEvent, localAiConnectionFingerprint, localAiSetup.provider]);

  const recordLocalAiClassificationError = useCallback((failure: LocalAiClassificationFailure) => {
    if (!localAiConnectionFingerprint) return;
    if (failure.connectionEvidence === "reachable") {
      applyLocalAiConnectionEvent(localAiSetup.provider, localAiConnectionFingerprint, {
        kind: "provider_contact_ok",
        message: failure.message,
      });
      return;
    }
    if (failure.connectionEvidence === "none") return;
    applyLocalAiConnectionEvent(localAiSetup.provider, localAiConnectionFingerprint, {
      kind: "classification_failure",
      message: failure.message,
    });
  }, [applyLocalAiConnectionEvent, localAiConnectionFingerprint, localAiSetup.provider]);

  const retestAttemptRef = useRef(0);
  useEffect(() => {
    retestAttemptRef.current = 0;
    localAiRetryAfterMsRef.current = null;
  }, [localAiConnectionFingerprint]);

  const { runAuto: runAutoConnectionTest } = aiConnectionTest;
  // A connected provider with unresolved classification failures shows as
  // "retrying" (the checking pill) and hides upgrade offers, yet nothing else
  // re-probes it until some later classification happens to succeed. After a
  // slow cold start that left the UI stuck for 12+ minutes (#1501), so it is
  // re-tested on the same backoff as an outright failure.
  const localAiRetestNeeded = localAiProviderStatus.kind === "failed"
    || (localAiProviderStatus.kind === "connected" && localAiConnectionFailureCount > 0);
  useEffect(() => {
    // "checking" means a probe is already in flight — keep the backoff level.
    if (localAiProviderStatus.kind === "checking") return;
    if (!localAiRetestNeeded) {
      retestAttemptRef.current = 0;
      return;
    }
    // While the setup dialog is open the user is driving tests by hand; an
    // automatic probe would overwrite the result they are looking at.
    if (aiSetupDialogOpen) return;
    const exponentialDelayMs = Math.min(AI_CONNECTION_RETEST_BASE_DELAY_MS * 2 ** retestAttemptRef.current, AI_CONNECTION_RETEST_MAX_DELAY_MS);
    const delayMs = Math.max(exponentialDelayMs, localAiRetryAfterMsRef.current ?? 0);
    const timeoutId = window.setTimeout(() => {
      retestAttemptRef.current += 1;
      void runAutoConnectionTest();
    }, delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [aiSetupDialogOpen, localAiProviderStatus, localAiRetestNeeded, runAutoConnectionTest]);

  const aiSetupDialogOpenRef = useRef(aiSetupDialogOpen);
  useEffect(() => {
    aiSetupDialogOpenRef.current = aiSetupDialogOpen;
  }, [aiSetupDialogOpen]);
  const lastOnlineProbeAtRef = useRef(0);
  useEffect(() => {
    if (!localAiRetestNeeded) return;
    const handleOnline = () => {
      // Same manual-testing guard as the backoff loop, and a floor between
      // probes so a flapping connection (VPN reconnects, Wi-Fi roaming)
      // cannot hammer the provider faster than the base backoff delay.
      if (aiSetupDialogOpenRef.current) return;
      const now = Date.now();
      if (now - lastOnlineProbeAtRef.current < AI_CONNECTION_RETEST_BASE_DELAY_MS) return;
      lastOnlineProbeAtRef.current = now;
      void runAutoConnectionTest();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [localAiRetestNeeded, runAutoConnectionTest]);

  useEffect(() => {
    persistLocalAiSetup(localAiSetup);
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
    providerCredentials: { openrouter_byok: openRouterCredential, self_hosted: customEndpointCredential },
    openRouterCredentialState: openRouterCredential.state,
    retryOpenRouterKeyRead: openRouterCredential.retry,
    customEndpointCredentialState,
    retryCustomEndpointKeyRead,
    aiSetupDialogOpen,
    localAiClassificationOptions,
    localAiConnectionFingerprint,
    localAiConnectionFailureCount,
    localAiConnectionFailureDetail,
    customEndpointAddressRepair,
    recordCustomEndpointAddressRepair,
    undoCustomEndpointAddressRepair,
    dismissCustomEndpointAddressRepair,
    localAiConnectionProviderLabel,
    localAiConnectionPersistentFailure,
    localAiMemoryUsageBytes,
    localAiProviderStatus,
    localAiSetup,
    directKeys,
    recordLocalAiClassificationError,
    recordLocalAiClassificationSummary,
    setAiSetupDialogOpen,
    setLocalAiSetup,
  };
}

export function resolvePreviewAwareInitialLocalAiSetup(
  initialSetup = resolveInitialLocalAiSetup(),
  isDevelopment = import.meta.env.DEV,
  previewFlag = import.meta.env.VITE_DRIFTY_PREVIEW,
): LocalAiSetupState {
  if (!isDevelopment || previewFlag !== "1") {
    if (!isPreviewAiMockBaseUrl(initialSetup.selfHostedBaseUrl)) return initialSetup;
    return {
      ...initialSetup,
      selfHostedBaseUrl: DEFAULT_LOCAL_AI_SETUP.selfHostedBaseUrl,
      selfHostedModel: PREVIEW_AI_MOCK_MODELS.includes(
        initialSetup.selfHostedModel as (typeof PREVIEW_AI_MOCK_MODELS)[number],
      )
        ? ""
        : initialSetup.selfHostedModel,
    };
  }
  if (initialSetup.selfHostedBaseUrl !== DEFAULT_LOCAL_AI_SETUP.selfHostedBaseUrl) return initialSetup;

  return {
    ...initialSetup,
    selfHostedBaseUrl: PREVIEW_AI_MOCK_BASE_URL,
    selfHostedModel: PREVIEW_AI_MOCK_MODELS.includes(
      initialSetup.selfHostedModel as (typeof PREVIEW_AI_MOCK_MODELS)[number],
    )
      ? initialSetup.selfHostedModel
      : "",
  };
}

export function toPersistedPreviewSafeLocalAiSetup(setup: LocalAiSetupState): PersistedLocalAiSetupState {
  if (!isPreviewAiMockBaseUrl(setup.selfHostedBaseUrl)) return toPersistedLocalAiSetup(setup);
  return toPersistedLocalAiSetup({
    ...setup,
    selfHostedBaseUrl: DEFAULT_LOCAL_AI_SETUP.selfHostedBaseUrl,
    selfHostedModel: PREVIEW_AI_MOCK_MODELS.includes(
      setup.selfHostedModel as (typeof PREVIEW_AI_MOCK_MODELS)[number],
    )
      ? ""
      : setup.selfHostedModel,
  });
}

export function persistLocalAiSetup(setup: LocalAiSetupState): boolean {
  try {
    window.localStorage.setItem(LOCAL_AI_SETUP_STORAGE_KEY, JSON.stringify(toPersistedPreviewSafeLocalAiSetup(setup)));
    return true;
  } catch {
    // Keep the in-memory selection usable when storage is temporarily unavailable.
    // Callers that need a durable transition can use the result to surface recovery.
    return false;
  }
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
