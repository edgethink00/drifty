import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  DEFAULT_LOCAL_AI_SETUP,
  type LocalAiSetupState,
} from "../settings/localAiSetup";
import { createChatClient } from "../chat/chatClient";
import { cliProviderName, isCliSetupChoice } from "./cliPilot";
import { testLocalAiConnection } from "../settings/aiConnectionTest";
import { useManagedLocalAiSetup } from "../settings/useManagedLocalAiSetup";
import type { CustomEndpointDraft } from "./OnboardingCustomEndpointSetup";
import type { TranslationKey } from "../localization/translations";
import {
  connectionChecksForSetup,
  CUSTOM_ENDPOINT_DEFAULT_DRAFT,
  customEndpointBaseUrlError,
  customEndpointModelError,
  maskApiKey,
  type ConnectionCheckStatus,
  type ConnectionFailure,
  type ConnectionPhase,
  type OnboardingStep,
  type SetupChoice,
} from "./onboardingFlow";
import { hasManagedLocalInstallStarted, isManagedLocalReady } from "./onboardingManagedLocalStatus";

type UseOnboardingConnectionFlowOptions = {
  readonly initialCustomEndpointDraft?: CustomEndpointDraft | undefined;
  readonly initialSetupChoice?: SetupChoice | null | undefined;
  readonly localAiSetup: LocalAiSetupState;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly step: OnboardingStep;
  /** Above zero, a CLI test runs on the connect step itself; each increment reruns it. */
  readonly inlineCliTestRunId?: number;
};

export function useOnboardingConnectionFlow({
  initialCustomEndpointDraft,
  initialSetupChoice,
  localAiSetup,
  onLocalAiSetupChange,
  step,
  inlineCliTestRunId = 0,
}: UseOnboardingConnectionFlowOptions) {
  const [setupChoice, setSetupChoice] = useState<SetupChoice | null>(initialSetupChoice ?? "simple");
  const [apiKey, setApiKey] = useState(localAiSetup.openRouterApiKey.trim());
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [customEndpointDraft, setCustomEndpointDraft] = useState<CustomEndpointDraft>(initialCustomEndpointDraft ?? CUSTOM_ENDPOINT_DEFAULT_DRAFT);
  // The endpoint key lives beside the draft instead of inside it: the draft is
  // written to onboarding progress storage, and secrets must never land there.
  const [customEndpointApiKey, setCustomEndpointApiKey] = useState(localAiSetup.selfHostedApiKey);
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>("idle");
  const [checkStatuses, setCheckStatuses] = useState<ConnectionCheckStatus[]>([]);
  const [connectionFailure, setConnectionFailure] = useState<ConnectionFailure | null>(null);
  const [testRunId, setTestRunId] = useState(0);

  const isCliSetup = isCliSetupChoice(setupChoice);
  const cliName = cliProviderName(setupChoice);
  const isByokSetup = setupChoice === "byok";
  const isCustomEndpointSetup = setupChoice === "custom_endpoint";
  const isManagedProviderSetup = setupChoice === "local_ai";
  const isUserManagedProviderSetup = isByokSetup || isCustomEndpointSetup || isCliSetup;
  const managedLocalAi = useManagedLocalAiSetup(
    step === "choose_setup" || setupChoice === "local_ai",
    onLocalAiSetupChange,
    true,
  );
  const managedLocalReady = isManagedLocalReady(managedLocalAi.status);
  const managedLocalStarted = hasManagedLocalInstallStarted(managedLocalAi.status);
  const connectionChecks = connectionChecksForSetup(setupChoice);
  const apiKeyIsValid = apiKey.trim().toLowerCase().startsWith("sk-or-");
  const customEndpointBaseUrlIssue = customEndpointBaseUrlError(customEndpointDraft.baseUrl);
  const customEndpointModelIssue = customEndpointModelError(customEndpointDraft.model);
  const customEndpointIsValid = customEndpointBaseUrlIssue === null && customEndpointModelIssue === null;
  const localAiSummaryLabel = managedLocalReady ? "Local model ready" : "Local model downloading";
  const userManagedSetupLabel = isByokSetup ? "BYOK selected" : "Custom endpoint selected";
  const userManagedConnectionLabel = isByokSetup ? "OpenRouter key connected" : "Custom endpoint connected";

  useEffect(() => {
    if (setupChoice !== "local_ai") return;
    const status = managedLocalAi.status;
    if (!isManagedLocalReady(status)) return;
    onLocalAiSetupChange((current) => {
      if (
        current.provider === "managed_local"
        && current.driftyRoute === "local"
        && current.managedLocalModelId === status.selectedModelId
        && current.managedLocalBaseUrl === status.baseUrl
        && current.managedLocalModel === status.model
      ) {
        return current;
      }
      return {
        ...current,
        provider: "managed_local",
        driftyRoute: "local",
        managedLocalModelId: status.selectedModelId,
        managedLocalBaseUrl: status.baseUrl,
        managedLocalModel: status.model,
      };
    });
  }, [managedLocalAi.status, onLocalAiSetupChange, setupChoice]);

  useEffect(() => {
    if (apiKeyTouched || setupChoice !== "byok") return;
    const savedApiKey = localAiSetup.openRouterApiKey.trim();
    if (!savedApiKey || apiKey === savedApiKey) return;
    setApiKey(savedApiKey);
  }, [apiKey, apiKeyTouched, localAiSetup.openRouterApiKey, setupChoice]);

  useEffect(() => runConnectionTest(step === "connect_server" && inlineCliTestRunId > 0 && isCliSetupChoice(setupChoice) ? "test_connection" : step), [
    inlineCliTestRunId,
    apiKey,
    apiKeyIsValid,
    connectionChecks,
    customEndpointBaseUrlIssue,
    customEndpointApiKey,
    customEndpointDraft.baseUrl,
    customEndpointDraft.model,
    customEndpointIsValid,
    customEndpointModelIssue,
    isByokSetup,
    isCustomEndpointSetup,
    isCliSetup,
    onLocalAiSetupChange,
    setupChoice,
    step,
    testRunId,
  ]);

  function resetConnectionValidation() {
    setConnectionPhase("idle");
    setCheckStatuses([]);
    setConnectionFailure(null);
  }
  const resetConnectionTest = useCallback(() => {
    setConnectionPhase("idle");
    setCheckStatuses([]);
    setConnectionFailure(null);
  }, []);

  const handleSetupChoice = useCallback((nextChoice: SetupChoice) => {
    setSetupChoice(nextChoice);
    setConnectionPhase("idle");
    setCheckStatuses([]);
    setConnectionFailure(null);
    setMaskedApiKey(null);
  }, []);

  function handleApiKeyChange(value: string) {
    setApiKeyTouched(true);
    setApiKey(value);
    const normalizedApiKey = value.trim();
    if (!normalizedApiKey || normalizedApiKey.toLowerCase().startsWith("sk-or-")) {
      onLocalAiSetupChange((current) => current.openRouterApiKey === normalizedApiKey
        ? current
        : { ...current, openRouterApiKey: normalizedApiKey });
    }
    resetConnectionValidation();
    setMaskedApiKey(null);
  }

  // Draft edits stay local to onboarding; the global AI setup only changes once
  // the connection test succeeds, so abandoning setup never leaves a half-configured provider.
  function handleCustomEndpointDraftChange(nextDraft: CustomEndpointDraft) {
    setCustomEndpointDraft(nextDraft);
    resetConnectionValidation();
  }

  function handleCustomEndpointApiKeyChange(value: string) {
    setCustomEndpointApiKey(value);
    resetConnectionValidation();
  }

  function runConnectionTest(stepToRun: OnboardingStep): (() => void) | undefined {
    if (stepToRun !== "test_connection" || !isUserManagedProviderSetup) return;
    const checks = connectionChecks;
    const failIndex = isCliSetup ? -1 : isByokSetup
      ? apiKeyIsValid ? -1 : 0
      : customEndpointBaseUrlIssue !== null
        ? 0
        : customEndpointModelIssue !== null
          ? 1
          : -1;
    let cancelled = false;
    let cliInstalled = false;

    setConnectionPhase("testing");
    setConnectionFailure(null);

    if (failIndex >= 0) {
      setCheckStatuses(checks.map((_, statusIndex) => statusIndex < failIndex ? "success" : statusIndex === failIndex ? "error" : "pending"));
      setConnectionFailure({ kind: "local", key: localValidationFailureKey(failIndex) });
      setConnectionPhase("failed");
      return () => {
        cancelled = true;
      };
    }

    const localSuccessCount = isCliSetup ? 0 : isByokSetup ? 1 : 2;
    setCheckStatuses(checks.map((_, statusIndex) => statusIndex < localSuccessCount ? "success" : statusIndex === localSuccessCount ? "loading" : "pending"));
    const setupSnapshot = connectionTestSetup();
    if (!setupSnapshot) {
      setConnectionFailure({ kind: "local", key: "settings.ai.connection.completeSettings" });
      setConnectionPhase("failed");
      return () => {
        cancelled = true;
      };
    }

    const test = async () => {
      if (isCliSetupChoice(setupSnapshot.provider)) {
        const status = await createChatClient().getStatus();
        if (cancelled) return null;
        const installed = status.providers.some(item => item.provider === (setupSnapshot.provider === "codex_cli" ? "codex" : "claude") && item.installed);
        if (!installed) return { kind: "error" as const, issueKind: "provider" as const, message: "cli_missing" };
        cliInstalled = true;
        setCheckStatuses(["success", "loading", "pending"]);
      }
      return isCliSetupChoice(setupSnapshot.provider) ? testLocalAiConnection(setupSnapshot, () => !cancelled) : testLocalAiConnection(setupSnapshot);
    };
    void test().then((result) => {
      if (!result) return;
      if (cancelled) return;
      if (result.kind === "error") {
        const failedIndex = isCliSetup ? result.message === "cli_missing" ? 0 : result.cliStage === "classifier" ? 2 : 1 : remoteFailureIndex(result.message, checks.length);
        setCheckStatuses(checks.map((_, statusIndex) => statusIndex < failedIndex ? "success" : statusIndex === failedIndex ? "error" : "pending"));
        setConnectionFailure({ kind: "remote", message: result.message, ...(result.cliFailureReason ? { cliFailureReason: result.cliFailureReason } : {}) });
        setConnectionPhase("failed");
        return;
      }
      setCheckStatuses(checks.map(() => "success"));
      setMaskedApiKey(setupChoice === "byok" ? maskApiKey(apiKey) : null);
      if (isCliSetupChoice(setupChoice)) onLocalAiSetupChange(current => ({ ...current, provider: setupChoice }));
      if (setupChoice === "byok") {
        onLocalAiSetupChange((current) => ({
          ...current,
          provider: "openrouter_byok",
          openRouterApiKey: apiKey.trim(),
        }));
      }
      if (setupChoice === "custom_endpoint") {
        onLocalAiSetupChange((current) => ({
          ...current,
          provider: "self_hosted",
          selfHostedBaseUrl: customEndpointDraft.baseUrl.trim(),
          selfHostedApiKey: customEndpointApiKey.trim(),
          selfHostedModel: customEndpointDraft.model.trim(),
        }));
      }
      setConnectionPhase("success");
    }).catch((error) => {
      if (cancelled) return;
      const failedIndex = isCliSetup ? cliInstalled ? 1 : 0 : isByokSetup ? 1 : checks.length - 1;
      setCheckStatuses(checks.map((_, statusIndex) => statusIndex < failedIndex ? "success" : statusIndex === failedIndex ? "error" : "pending"));
      setConnectionFailure({ kind: "remote", message: messageFromUnknownError(error) });
      setConnectionPhase("failed");
    });

    return () => {
      cancelled = true;
    };
  }

  function connectionTestSetup(): LocalAiSetupState | null {
    if (isCliSetupChoice(setupChoice)) return { ...DEFAULT_LOCAL_AI_SETUP, provider: setupChoice };
    if (isByokSetup && apiKeyIsValid) {
      return {
        ...DEFAULT_LOCAL_AI_SETUP,
        provider: "openrouter_byok",
        openRouterApiKey: apiKey.trim(),
      };
    }
    if (isCustomEndpointSetup && customEndpointIsValid) {
      return {
        ...DEFAULT_LOCAL_AI_SETUP,
        provider: "self_hosted",
        selfHostedBaseUrl: customEndpointDraft.baseUrl.trim(),
        selfHostedApiKey: customEndpointApiKey.trim(),
        selfHostedModel: customEndpointDraft.model.trim(),
      };
    }
    return null;
  }

  function localValidationFailureKey(index: number): TranslationKey {
    if (isByokSetup) return "onboarding.connection.invalidKey";
    if (index === 0) return customEndpointBaseUrlIssue ?? "onboarding.connection.baseUrlScheme";
    return customEndpointModelIssue ?? "onboarding.connection.modelMissing";
  }

  function remoteFailureIndex(message: string, checksLength: number): number {
    if (isByokSetup && message.toLowerCase().includes("no assistant message")) return Math.min(2, checksLength - 1);
    return isByokSetup ? Math.min(1, checksLength - 1) : checksLength - 1;
  }

  function messageFromUnknownError(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.trim()) return error.trim();
    return "Connection test failed.";
  }

  return {
    apiKey,
    apiKeyIsValid,
    isCliSetup,
    cliName,
    checkStatuses,
    connectionChecks,
    connectionFailure,
    connectionPhase,
    customEndpointBaseUrlIssue,
    customEndpointApiKey,
    customEndpointDraft,
    customEndpointIsValid,
    customEndpointModelIssue,
    handleApiKeyChange,
    handleCustomEndpointApiKeyChange,
    handleCustomEndpointDraftChange,
    handleSetupChoice,
    isByokSetup,
    isCustomEndpointSetup,
    isManagedProviderSetup,
    isUserManagedProviderSetup,
    localAiSummaryLabel,
    managedLocalAi,
    managedLocalReady,
    managedLocalStarted,
    maskedApiKey,
    retryConnectionTest: () => setTestRunId((current) => current + 1),
    resetConnectionTest,
    setTestRunId,
    setupChoice,
    testRunId,
    userManagedConnectionLabel,
    userManagedSetupLabel,
  };
}
