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
import { loadCustomEndpointApiKey, saveCustomEndpointApiKey } from "./customEndpointApiKeyStore";
import { getManagedLocalAiStatus, type ManagedLocalAiStatus } from "./managedLocalAiClient";
import { loadOpenRouterApiKey, saveOpenRouterApiKey } from "./openRouterApiKeyStore";
import { isPreviewAiMockBaseUrl, PREVIEW_AI_MOCK_BASE_URL, PREVIEW_AI_MOCK_MODELS } from "./previewAiContract";
import { useAiConnectionTestRunner, type UseAiConnectionTestRunnerResult } from "./useAiConnectionTestRunner";

const MANAGED_LOCAL_MEMORY_POLL_MS = 5_000;
const PROVIDER_KEY_SAVE_DELAY_MS = 400;
// Automatic recovery probe while the provider check is failed: back off
// 30s → 1m → 2m → 4m, capped at 5 minutes between attempts. Each probe is a
// single ~1-token chat completion, so even a day-long outage stays negligible.
const AI_CONNECTION_RETEST_BASE_DELAY_MS = 30_000;
const AI_CONNECTION_RETEST_MAX_DELAY_MS = 5 * 60_000;

type UseAiSetupControllerResult = {
  readonly aiConnectionTest: UseAiConnectionTestRunnerResult;
  readonly customEndpointCredentialState: import("./intelligenceRouting").AnalysisCredentialState;
  readonly retryCustomEndpointKeyRead: () => void;
  readonly aiSetupDialogOpen: boolean;
  readonly localAiClassificationOptions: LocalAiClassificationOptions | null;
  readonly localAiConnectionFingerprint: string | null;
  /** Consecutive failures for the current provider fingerprint, including the quiet first failure. */
  readonly localAiConnectionFailureCount: number;
  readonly localAiConnectionProviderLabel: ReturnType<typeof localAiProviderLabel>;
  /** True once the failure is confirmed by repeated probes — gates chrome/status disconnect surfaces. */
  readonly localAiConnectionPersistentFailure: boolean;
  readonly localAiMemoryUsageBytes: number | null;
  readonly localAiProviderStatus: LocalAiProviderStatus;
  readonly localAiSetup: LocalAiSetupState;
  readonly recordLocalAiClassificationError: (failure: LocalAiClassificationFailure) => void;
  readonly recordLocalAiClassificationSummary: (summary: AiClassificationSummary) => void;
  readonly setAiSetupDialogOpen: Dispatch<SetStateAction<boolean>>;
  readonly setLocalAiSetup: Dispatch<SetStateAction<LocalAiSetupState>>;
};

export function useAiSetupController(): UseAiSetupControllerResult {
  const [localAiSetup, setLocalAiSetup] = useState<LocalAiSetupState>(resolvePreviewAwareInitialLocalAiSetup);
  const [localAiConnectionCheck, setLocalAiConnectionCheck] = useState<LocalAiConnectionCheck | null>(null);
  const [localAiMemoryUsageBytes, setLocalAiMemoryUsageBytes] = useState<number | null>(null);
  const [aiSetupDialogOpen, setAiSetupDialogOpen] = useState(false);
  const [openRouterKeyLoaded, setOpenRouterKeyLoaded] = useState(false);
  const lastSavedOpenRouterKeyRef = useRef<string | null>(null);
  const keyEditRef = useRef({ value: localAiSetup.openRouterApiKey, revision: 0 });
  if (keyEditRef.current.value !== localAiSetup.openRouterApiKey) {
    keyEditRef.current = { value: localAiSetup.openRouterApiKey, revision: keyEditRef.current.revision + 1 };
  }
  const [customEndpointCredentialState, setCustomEndpointCredentialState] = useState<import("./intelligenceRouting").AnalysisCredentialState>("idle");
  const [customEndpointKeyLoaded, setCustomEndpointKeyLoaded] = useState(false);
  const [customEndpointKeyReadRevision, setCustomEndpointKeyReadRevision] = useState(0);
  const retryCustomEndpointKeyRead = useCallback(() => setCustomEndpointKeyReadRevision(current => current + 1), []);
  const lastSavedCustomEndpointKeyRef = useRef<string | null>(null);
  const customEndpointKeyEditRef = useRef({ value: localAiSetup.selfHostedApiKey, revision: 0 });
  if (customEndpointKeyEditRef.current.value !== localAiSetup.selfHostedApiKey) {
    customEndpointKeyEditRef.current = {
      value: localAiSetup.selfHostedApiKey,
      revision: customEndpointKeyEditRef.current.revision + 1,
    };
  }
  // Intelligence can use the shared custom endpoint while Classification uses
  // another provider; its key must still be available after a restart.
  const [analysisUsesCustomEndpoint] = useState(() => {
    const saved = resolveInitialAnalysisAiSetup();
    return saved.provider === "self_hosted" && saved.selectionSource !== "automatic";
  });
  const localAiRetryAfterMsRef = useRef<number | null>(null);

  const localAiClassificationOptions = useMemo(() => localAiProviderConfigFromSetup(localAiSetup), [localAiSetup]);
  const localAiConnectionFingerprint = useMemo(() => localAiSetupFingerprint(localAiSetup), [localAiSetup]);
  const localAiConnectionProviderLabel = localAiProviderLabel(localAiSetup);

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
      : { kind: "connection_test_failure", issueKind: result.issueKind, message: result.message });
  }, [applyLocalAiConnectionEvent]);

  const aiConnectionTest = useAiConnectionTestRunner({
    localAiSetup,
    onLocalAiConnectionTestResult: recordLocalAiConnectionTestResult,
    // Probing a key-protected custom endpoint before its stored key is restored
    // would log a spurious 401 on every launch.
    autoTestPaused: localAiSetup.provider === "self_hosted" && !customEndpointKeyLoaded,
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

  // Only touch the Keychain when the OpenRouter key is actually needed: the BYOK
  // provider is active (classification passes read the in-memory key) or the user
  // has the AI setup dialog open (to prefill/show the saved key). Reading it
  // unconditionally on every launch makes macOS re-prompt for Keychain access after
  // each app update — even in local mode — because the updated binary's signature is
  // not yet on the item's ACL. Gating the read keeps local-mode launches Keychain-free.
  const shouldLoadOpenRouterKey = localAiSetup.provider === "openrouter_byok" || aiSetupDialogOpen;
  useEffect(() => {
    if (!shouldLoadOpenRouterKey || openRouterKeyLoaded) return;
    let cancelled = false;
    const keyAtLoadStart = keyEditRef.current;
    void loadOpenRouterApiKey().then((savedApiKey) => {
      if (cancelled) return;
      const normalizedApiKey = savedApiKey?.trim() ?? "";
      lastSavedOpenRouterKeyRef.current = normalizedApiKey;
      if (normalizedApiKey) {
        setLocalAiSetup((current) => keyEditRef.current.revision !== keyAtLoadStart.revision
          || current.openRouterApiKey !== keyAtLoadStart.value
          || current.openRouterApiKey.trim() === normalizedApiKey
          ? current
          : { ...current, openRouterApiKey: normalizedApiKey });
      }
      setOpenRouterKeyLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [shouldLoadOpenRouterKey, openRouterKeyLoaded]);

  useEffect(() => {
    if (!openRouterKeyLoaded) return;
    const normalizedApiKey = localAiSetup.openRouterApiKey.trim();
    if (lastSavedOpenRouterKeyRef.current === normalizedApiKey) return;
    const timeoutId = window.setTimeout(() => {
      void saveOpenRouterApiKey(normalizedApiKey).then(() => {
        lastSavedOpenRouterKeyRef.current = normalizedApiKey;
      });
    }, PROVIDER_KEY_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [localAiSetup.openRouterApiKey, openRouterKeyLoaded]);

  // Same Keychain gating as the OpenRouter key: only read the custom endpoint key
  // when a task actually routes through the custom endpoint or the AI setup
  // dialog is open. Keyless endpoints never create an item, so they never prompt.
  const shouldLoadCustomEndpointKey = localAiSetup.provider === "self_hosted"
    || analysisUsesCustomEndpoint
    || aiSetupDialogOpen;
  useEffect(() => {
    if (!shouldLoadCustomEndpointKey || customEndpointKeyLoaded) return;
    let cancelled = false;
    const keyAtLoadStart = customEndpointKeyEditRef.current;
    setCustomEndpointCredentialState("loading");
    void loadCustomEndpointApiKey({ throwOnError: true }).then((savedApiKey) => {
      if (cancelled) return;
      const normalizedApiKey = savedApiKey?.trim() ?? "";
      lastSavedCustomEndpointKeyRef.current = normalizedApiKey;
      // Decide outside the state updater: React may invoke an updater twice, and
      // the edit ref changes once the first result renders, so reading it inside
      // would make the second invocation discard the restored key.
      const editedDuringLoad = customEndpointKeyEditRef.current.revision !== keyAtLoadStart.revision;
      if (normalizedApiKey && !editedDuringLoad) {
        setLocalAiSetup((current) => current.selfHostedApiKey !== keyAtLoadStart.value
          || current.selfHostedApiKey.trim() === normalizedApiKey
          ? current
          : { ...current, selfHostedApiKey: normalizedApiKey });
      }
      setCustomEndpointKeyLoaded(true);
      setCustomEndpointCredentialState((editedDuringLoad ? customEndpointKeyEditRef.current.value.trim() : normalizedApiKey) ? "ready" : "missing");
    }).catch(() => {
      if (!cancelled) setCustomEndpointCredentialState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [shouldLoadCustomEndpointKey, customEndpointKeyLoaded, customEndpointKeyReadRevision]);

  // A deliberate key edit resolves an unknown/failed read. Do not let a late
  // Keychain response overwrite the edit or prevent it from being saved.
  useEffect(() => {
    if (customEndpointKeyEditRef.current.revision === 0) return;
    setCustomEndpointKeyLoaded(true);
    setCustomEndpointCredentialState(localAiSetup.selfHostedApiKey.trim() ? "ready" : "missing");
  }, [localAiSetup.selfHostedApiKey]);

  useEffect(() => {
    if (!customEndpointKeyLoaded) return;
    const normalizedApiKey = localAiSetup.selfHostedApiKey.trim();
    if (lastSavedCustomEndpointKeyRef.current === normalizedApiKey) return;
    const timeoutId = window.setTimeout(() => {
      void saveCustomEndpointApiKey(normalizedApiKey).then(() => {
        lastSavedCustomEndpointKeyRef.current = normalizedApiKey;
      });
    }, PROVIDER_KEY_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [localAiSetup.selfHostedApiKey, customEndpointKeyLoaded]);

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
    customEndpointCredentialState,
    retryCustomEndpointKeyRead,
    aiSetupDialogOpen,
    localAiClassificationOptions,
    localAiConnectionFingerprint,
    localAiConnectionFailureCount,
    localAiConnectionProviderLabel,
    localAiConnectionPersistentFailure,
    localAiMemoryUsageBytes,
    localAiProviderStatus,
    localAiSetup,
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
