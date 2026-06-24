import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { LocalAiSetupState } from "../settings/localAiSetup";
import { useManagedLocalAiSetup } from "../settings/useManagedLocalAiSetup";
import type { CustomEndpointDraft } from "./OnboardingCustomEndpointSetup";
import {
  connectionChecksForSetup,
  CUSTOM_ENDPOINT_DEFAULT_DRAFT,
  customEndpointBaseUrlError,
  customEndpointModelError,
  maskApiKey,
  type ConnectionCheckStatus,
  type ConnectionPhase,
  type OnboardingStep,
  type SetupChoice,
} from "./onboardingFlow";
import { hasManagedLocalInstallStarted, isManagedLocalReady } from "./onboardingManagedLocalStatus";

type UseOnboardingConnectionFlowOptions = {
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly step: OnboardingStep;
};

export function useOnboardingConnectionFlow({
  onLocalAiSetupChange,
  step,
}: UseOnboardingConnectionFlowOptions) {
  const [setupChoice, setSetupChoice] = useState<SetupChoice | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [customEndpointDraft, setCustomEndpointDraft] = useState<CustomEndpointDraft>(CUSTOM_ENDPOINT_DEFAULT_DRAFT);
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>("idle");
  const [checkStatuses, setCheckStatuses] = useState<ConnectionCheckStatus[]>([]);
  const [connectionFailureLabel, setConnectionFailureLabel] = useState<string | null>(null);
  const [testRunId, setTestRunId] = useState(0);

  const isByokSetup = setupChoice === "byok";
  const isCustomEndpointSetup = setupChoice === "custom_endpoint";
  const isManagedProviderSetup = setupChoice === "local_ai";
  const isUserManagedProviderSetup = isByokSetup || isCustomEndpointSetup;
  const managedLocalAi = useManagedLocalAiSetup(setupChoice === "local_ai", onLocalAiSetupChange, true);
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
    onLocalAiSetupChange((current) => ({
      ...current,
      provider: "managed_local",
      driftyRoute: "local",
      managedLocalModelId: status.selectedModelId,
      managedLocalBaseUrl: status.baseUrl,
      managedLocalModel: status.model,
    }));
  }, [managedLocalAi.status, onLocalAiSetupChange, setupChoice]);

  useEffect(() => runConnectionTest(step), [
    apiKey,
    apiKeyIsValid,
    connectionChecks,
    customEndpointBaseUrlIssue,
    customEndpointDraft.baseUrl,
    customEndpointDraft.model,
    customEndpointModelIssue,
    isByokSetup,
    onLocalAiSetupChange,
    setupChoice,
    step,
    testRunId,
  ]);

  function resetConnectionValidation() {
    setConnectionPhase("idle");
    setCheckStatuses([]);
    setConnectionFailureLabel(null);
  }

  function handleSetupChoice(nextChoice: SetupChoice) {
    setSetupChoice(nextChoice);
    resetConnectionValidation();
    setMaskedApiKey(null);
  }

  function handleApiKeyChange(value: string) {
    setApiKey(value);
    resetConnectionValidation();
    setMaskedApiKey(null);
  }

  function handleCustomEndpointDraftChange(nextDraft: CustomEndpointDraft) {
    setCustomEndpointDraft(nextDraft);
    resetConnectionValidation();
    onLocalAiSetupChange((current) => ({
      ...current,
      provider: "self_hosted",
      selfHostedBaseUrl: nextDraft.baseUrl,
      selfHostedModel: nextDraft.model,
    }));
  }

  function runConnectionTest(stepToRun: OnboardingStep) {
    if (stepToRun !== "test_connection") return;
    const checks = connectionChecks;
    const failIndex = isByokSetup
      ? apiKeyIsValid ? -1 : 0
      : customEndpointBaseUrlIssue !== null
        ? 0
        : customEndpointModelIssue !== null
          ? 1
          : -1;
    setConnectionPhase("testing");
    setConnectionFailureLabel(null);
    setCheckStatuses(checks.map(() => "pending"));
    let cancelled = false;
    const timers: number[] = [];
    function runCheck(index: number) {
      if (cancelled) return;
      if (index >= checks.length) {
        setMaskedApiKey(setupChoice === "byok" ? maskApiKey(apiKey) : null);
        if (setupChoice === "custom_endpoint") {
          onLocalAiSetupChange((current) => ({
            ...current,
            provider: "self_hosted",
            selfHostedBaseUrl: customEndpointDraft.baseUrl.trim(),
            selfHostedModel: customEndpointDraft.model.trim(),
          }));
        }
        setConnectionPhase("success");
        return;
      }
      setCheckStatuses((current) => current.map((status, statusIndex) => (statusIndex === index ? "loading" : status)));
      const timerId = window.setTimeout(() => {
        if (cancelled) return;
        const failedHere = failIndex === index;
        setCheckStatuses((current) => current.map((status, statusIndex) => (statusIndex === index ? failedHere ? "error" : "success" : status)));
        if (failedHere) {
          setConnectionFailureLabel(checks[index]?.label ?? "the connection check");
          setConnectionPhase("failed");
          return;
        }
        runCheck(index + 1);
      }, 260);
      timers.push(timerId);
    }
    const startTimerId = window.setTimeout(() => runCheck(0), 120);
    timers.push(startTimerId);
    return () => {
      cancelled = true;
      for (const timerId of timers) window.clearTimeout(timerId);
    };
  }

  return {
    apiKey,
    apiKeyIsValid,
    checkStatuses,
    connectionChecks,
    connectionFailureLabel,
    connectionPhase,
    customEndpointBaseUrlIssue,
    customEndpointDraft,
    customEndpointIsValid,
    customEndpointModelIssue,
    handleApiKeyChange,
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
    setTestRunId,
    setupChoice,
    testRunId,
    userManagedConnectionLabel,
    userManagedSetupLabel,
  };
}
