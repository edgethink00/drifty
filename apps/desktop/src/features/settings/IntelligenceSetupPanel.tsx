import { analysisConnectionLabel } from "./sharedAiConnection";
import { useEffect, useRef, useState } from "react";

import { aiProviderBrandMark } from "./AiProviderBrandMark";
import { testLocalAiConnection, testOpenAiCompatibleConnection, type AiConnectionTestResult } from "./aiConnectionTest";
import { OpenRouterConnectionFields } from "./OpenRouterSetupPanel";
import { OpenRouterModelDialog } from "./AiSetupModelDialogs";
import { ModalPresence } from "../../components/ModalPresence";
import { AiConnectionTestAction } from "./AiConnectionTestAction";
import { testAnthropicConnection } from "./anthropicConnectionTest";
import { testCloudAiConnection } from "./cloudAiConnectionTest";
import { useAiSetupModelPickers } from "./useAiSetupModelPickers";
import { AiSetupConnectionDetails, AiSetupSectionCard } from "./AiSetupSectionCards";
import { CustomEndpointSetupPanel } from "./CustomEndpointSetupPanel";
import { DirectProviderConnectionFields } from "./DirectProviderConnectionFields";
import { ModelBeingUsedCard } from "./ModelBeingUsedCard";
import { type SettingsSelectOption } from "./SettingsSelect";
import { ANALYSIS_ANTHROPIC_MODEL_SUGGESTIONS, ANALYSIS_OPENAI_MODEL_SUGGESTIONS, ANALYSIS_RECOMMENDED_MODELS, DEFAULT_ANALYSIS_MODEL, DEFAULT_ANALYSIS_ANTHROPIC_MODEL, DEFAULT_ANALYSIS_OPENAI_MODEL, analysisModelDisplayLabel } from "./analysisModelSetup";
import type { AnalysisAiSetupState, AnalysisProvider } from "./analysisModelSetup";
import { DEFAULT_LOCAL_AI_SETUP, normalizeOpenAiCompatibleBaseUrl } from "./localAiSetup";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizeAiConnectionTestMessage } from "../localization/aiStatusTranslations";

const CLOUD_MANAGED_MODEL_ID = "cloud_managed";
const CUSTOM_ENDPOINT_MODEL_ID = "custom_endpoint";

export interface IntelligenceSetupPanelProps {
  readonly setup: AnalysisAiSetupState;
  readonly effectiveSetup?: AnalysisAiSetupState;
  readonly onProviderVisible?: (provider: AnalysisProvider) => void;
  readonly onChange: (next: AnalysisAiSetupState) => void;
  readonly openRouterConnected: boolean;
  readonly openRouterApiKey?: string;
  readonly onOpenRouterApiKeyChange?: (value: string) => void;
  readonly onDialogOpenChange?: (open: boolean) => void;
  readonly showLocalQuality?: boolean;
  /** Whether the Drifty Cloud analysis model can be selected (active OR trialing plan). */
  readonly cloudSelectable: boolean;
  /** "Upgrade"/"Opening" label when the cloud plan needs upgrading (trialing OR no-sub); null for active/locked. */
  readonly cloudSubscribeActionLabel: string | null;
  readonly cloudSubscribeActionDisabled: boolean;
  /** True when there's a subscription whose billing can be managed (active OR locked). */
  readonly canManageBilling: boolean;
  readonly onStartCloudSetup: () => void | Promise<void>;
  readonly onManageCloudBilling: () => void | Promise<void>;
}

/** Drifty Cloud billing state the analysis summary needs to gate the cloud model row. */
type CloudBilling = {
  readonly selectable: boolean;
  readonly upgradeLabel: string | null;
  readonly upgradeDisabled: boolean;
  readonly canManageBilling: boolean;
  readonly onStartCloudSetup: () => void | Promise<void>;
  readonly onManageCloudBilling: () => void | Promise<void>;
};

/**
 * Optional project/title model override: a "Model being used" summary on top,
 * then the same stack of expandable connection cards as the main connection.
 * Every card maps to a real analysis provider: Drifty Cloud, OpenRouter, direct
 * OpenAI and Anthropic keys, and an OpenAI-compatible custom endpoint.
 */
type IntelligenceCardId = "drifty" | "openrouter" | "custom" | "anthropic" | "chatgpt";

const CARD_FOR_PROVIDER: Record<AnalysisProvider, IntelligenceCardId> = {
  cloud: "drifty",
  managed_local: "drifty",
  openrouter: "openrouter",
  self_hosted: "custom",
  anthropic: "anthropic",
  openai: "chatgpt",
};

const OPENAI_MODEL_DATALIST_ID = "intelligence-openai-model-options";
const ANTHROPIC_MODEL_DATALIST_ID = "intelligence-anthropic-model-options";

type SummaryInfo = {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly statusLabel: string;
  readonly tone: "ok" | "warning";
  readonly ready: boolean;
};

type ConnectionTestConfiguration = {
  readonly provider: AnalysisProvider;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModels: string;
  readonly cloudSelectable: boolean;
};

type TaggedConnectionTestResult = {
  readonly configurationRevision: number;
  readonly result: AiConnectionTestResult;
};

function summarizeAnalysisSetup(setup: AnalysisAiSetupState, openRouterConnected: boolean, cloud: CloudBilling, t: LocalizationController["t"]): SummaryInfo {
  switch (setup.provider) {
    case "managed_local":
      return { providerLabel: t("settings.ai.localProvider"), modelLabel: analysisConnectionLabel(setup), statusLabel: t(setup.managedLocal?.baseUrl ? "settings.intelligence.configured" : "settings.intelligence.needsSetup"), tone: setup.managedLocal?.baseUrl ? "ok" : "warning", ready: Boolean(setup.managedLocal?.baseUrl) };
    case "cloud":
      // Not subscribed (nor trialing) → the cloud model isn't usable yet: surface a
      // needs-setup state rather than a committed "Drifty Cloud" selection.
      return cloud.selectable
        ? { providerLabel: "Drifty Cloud", modelLabel: t("settings.intelligence.managedByDrifty"), statusLabel: t("settings.intelligence.available"), tone: "ok", ready: true }
        : { providerLabel: "Drifty Cloud", modelLabel: t("settings.intelligence.notSet"), statusLabel: t("settings.intelligence.needsSetup"), tone: "warning", ready: false };
    case "openrouter": {
      const modelLabel = analysisModelDisplayLabel(setup.openRouterModel.trim() || DEFAULT_ANALYSIS_MODEL);
      return openRouterConnected
        ? { providerLabel: "OpenRouter", modelLabel, statusLabel: t("settings.intelligence.configured"), tone: "ok", ready: true }
        : { providerLabel: "OpenRouter", modelLabel, statusLabel: t("settings.intelligence.needsSetup"), tone: "warning", ready: false };
    }
    case "openai": {
      const configured = setup.openaiApiKey.trim().length > 0 && setup.openaiModel.trim().length > 0;
      const modelLabel = setup.openaiModel.trim() ? analysisModelDisplayLabel(setup.openaiModel) : t("settings.intelligence.notSet");
      return configured
        ? { providerLabel: "OpenAI", modelLabel, statusLabel: t("settings.intelligence.configured"), tone: "ok", ready: true }
        : { providerLabel: "OpenAI", modelLabel, statusLabel: t("settings.intelligence.needsSetup"), tone: "warning", ready: false };
    }
    case "anthropic": {
      const configured = setup.anthropicApiKey.trim().length > 0 && setup.anthropicModel.trim().length > 0;
      const modelLabel = setup.anthropicModel.trim() ? analysisModelDisplayLabel(setup.anthropicModel) : t("settings.intelligence.notSet");
      return configured
        ? { providerLabel: "Anthropic", modelLabel, statusLabel: t("settings.intelligence.configured"), tone: "ok", ready: true }
        : { providerLabel: "Anthropic", modelLabel, statusLabel: t("settings.intelligence.needsSetup"), tone: "warning", ready: false };
    }
    case "self_hosted": {
      const configured = Boolean(normalizeOpenAiCompatibleBaseUrl(setup.selfHostedBaseUrl) && setup.selfHostedModel.trim());
      const modelLabel = setup.selfHostedModel.trim() || t("settings.intelligence.notSet");
      return configured
        ? { providerLabel: t("settings.ai.customEndpoint"), modelLabel, statusLabel: t("settings.intelligence.configured"), tone: "ok", ready: true }
        : { providerLabel: t("settings.ai.customEndpoint"), modelLabel, statusLabel: t("settings.intelligence.needsSetup"), tone: "warning", ready: false };
    }
    default:
      return assertNever(setup.provider);
  }
}

/** The summary model dropdown's current value for each provider. Empty string → placeholder. */
function summaryModelValue(setup: AnalysisAiSetupState, cloud: CloudBilling): string {
  switch (setup.provider) {
    case "managed_local": return setup.managedLocal?.model ?? "";
    case "cloud":
      return cloud.selectable ? CLOUD_MANAGED_MODEL_ID : "";
    case "openrouter":
      return setup.openRouterModel.trim() || DEFAULT_ANALYSIS_MODEL;
    case "openai":
      return setup.openaiModel.trim() || DEFAULT_ANALYSIS_OPENAI_MODEL;
    case "anthropic":
      return setup.anthropicModel.trim() || DEFAULT_ANALYSIS_ANTHROPIC_MODEL;
    case "self_hosted":
      return CUSTOM_ENDPOINT_MODEL_ID;
    default:
      return assertNever(setup.provider);
  }
}

/**
 * Options for the summary model dropdown. Only OpenRouter exposes a real picker
 * here; the direct-key + custom providers surface a single read-only entry and
 * edit their model id inside the provider card below.
 */
function summaryModelOptions(setup: AnalysisAiSetupState, cloud: CloudBilling, t: LocalizationController["t"]): SettingsSelectOption<string>[] {
  switch (setup.provider) {
    case "managed_local": return [{ value: setup.managedLocal?.model ?? "", label: analysisConnectionLabel(setup) }];
    case "cloud":
      // Mirror the Classification tab: no-sub/trialing show Upgrade (trialing stays
      // selectable); active/locked show Manage billing (locked stays disabled so a
      // blocked subscription routes to the portal, never a second checkout).
      return [{
        value: CLOUD_MANAGED_MODEL_ID,
        label: t("settings.intelligence.managedByDrifty"),
        disabled: !cloud.selectable,
        ...(cloud.upgradeLabel !== null
          ? {
            actionLabel: cloud.upgradeLabel,
            actionAriaLabel: cloud.upgradeLabel,
            actionDisabled: cloud.upgradeDisabled,
            onAction: () => {
              void cloud.onStartCloudSetup();
            },
          }
          : cloud.canManageBilling
            ? {
              actionLabel: t("settings.account.manageBilling"),
              actionAriaLabel: t("settings.account.manageBilling"),
              actionOnHover: cloud.selectable,
              onAction: () => {
                void cloud.onManageCloudBilling();
              },
            }
            : {}),
      }];
    case "openrouter":
      // OpenRouter options come from the same picker as the dialog below.
      return [];
    case "openai": {
      const options: SettingsSelectOption<string>[] = ANALYSIS_OPENAI_MODEL_SUGGESTIONS.map((model) => ({ value: model, label: analysisModelDisplayLabel(model) }));
      const current = setup.openaiModel.trim();
      if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: analysisModelDisplayLabel(current) });
      return options;
    }
    case "anthropic": {
      const options: SettingsSelectOption<string>[] = ANALYSIS_ANTHROPIC_MODEL_SUGGESTIONS.map((model) => ({ value: model, label: analysisModelDisplayLabel(model) }));
      const current = setup.anthropicModel.trim();
      if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: analysisModelDisplayLabel(current) });
      return options;
    }
    case "self_hosted":
      return [{ value: CUSTOM_ENDPOINT_MODEL_ID, label: setup.selfHostedModel.trim() || t("settings.ai.customEndpoint") }];
    default:
      return assertNever(setup.provider);
  }
}

export function IntelligenceSetupPanel({ setup, effectiveSetup = setup, onProviderVisible, onChange, openRouterConnected, openRouterApiKey, onOpenRouterApiKeyChange, onDialogOpenChange, showLocalQuality = true, cloudSelectable, cloudSubscribeActionLabel, cloudSubscribeActionDisabled, canManageBilling, onStartCloudSetup, onManageCloudBilling }: IntelligenceSetupPanelProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const sharedOpenRouterKey = openRouterApiKey ?? setup.openRouterApiKey;
  const hasOpenRouterKey = openRouterApiKey !== undefined ? Boolean(openRouterApiKey.trim()) : Boolean(sharedOpenRouterKey.trim()) || openRouterConnected;
  const pickerSetup = { ...DEFAULT_LOCAL_AI_SETUP, openRouterModel: setup.openRouterModel, openRouterFallbackModels: setup.openRouterFallbackModels };
  const modelPickers = useAiSetupModelPickers(pickerSetup, (update) => {
    const next = typeof update === "function" ? update(pickerSetup) : update;
    onChange({ ...setup, openRouterModel: next.openRouterModel, openRouterFallbackModels: next.openRouterFallbackModels });
  }, ANALYSIS_RECOMMENDED_MODELS);
  const cloud: CloudBilling = { selectable: cloudSelectable, upgradeLabel: cloudSubscribeActionLabel, upgradeDisabled: cloudSubscribeActionDisabled, canManageBilling, onStartCloudSetup, onManageCloudBilling };
  // Whether a provider is ready to be the active analysis provider. Key-based
  // providers need their credentials first; Drifty Cloud is gated by subscription
  // in the model dropdown, so it always counts as "reachable" here.
  const providerReady = (provider: AnalysisProvider): boolean => {
    switch (provider) {
      case "managed_local": return Boolean(setup.managedLocal?.baseUrl && setup.managedLocal.model);
      case "cloud":
        return true;
      case "openrouter":
        return hasOpenRouterKey && Boolean(setup.openRouterModel.trim());
      case "openai":
        return Boolean(setup.openaiApiKey.trim() && setup.openaiModel.trim());
      case "anthropic":
        return Boolean(setup.anthropicApiKey.trim() && setup.anthropicModel.trim());
      case "self_hosted":
        return Boolean(normalizeOpenAiCompatibleBaseUrl(setup.selfHostedBaseUrl) && setup.selfHostedModel.trim());
      default:
        return true;
    }
  };
  const providerOptions = [
    { value: "managed_local", label: t("settings.ai.localProvider"), muted: !providerReady("managed_local") },
    { value: "cloud", label: "Drifty Cloud", icon: aiProviderBrandMark("drifty", { pick: true }) },
    { value: "openrouter", label: "OpenRouter", icon: aiProviderBrandMark("openrouter", { pick: true }), muted: !providerReady("openrouter") },
    { value: "self_hosted", label: t("settings.ai.customEndpoint"), icon: aiProviderBrandMark("custom", { pick: true }), muted: !providerReady("self_hosted") },
    { value: "openai", label: "OpenAI", icon: aiProviderBrandMark("openai", { pick: true }), muted: !providerReady("openai") },
    { value: "anthropic", label: "Anthropic", icon: aiProviderBrandMark("anthropic", { pick: true }), muted: !providerReady("anthropic") },
  ] satisfies readonly SettingsSelectOption<AnalysisProvider>[];
  // Which provider card is expanded. Defaults to the active provider so the tab
  // opens focused on whatever analysis model is currently in use.
  const [expandedCard, setExpandedCard] = useState<IntelligenceCardId | null>(() => CARD_FOR_PROVIDER[setup.provider]);
  useEffect(() => {
    // Reuse the existing controller's on-demand Keychain loading when these fields are visible.
    onDialogOpenChange?.((expandedCard !== null && expandedCard !== "drifty") || modelPickers.openRouterModelPickerOpen);
    return () => onDialogOpenChange?.(false);
  }, [expandedCard, modelPickers.openRouterModelPickerOpen, onDialogOpenChange]);
  const summary = summarizeAnalysisSetup(effectiveSetup, hasOpenRouterKey, cloud, t);
  const [taggedConnectionTestResult, setTaggedConnectionTestResult] = useState<TaggedConnectionTestResult | null>(null);
  const [runningConfigurationRevision, setRunningConfigurationRevision] = useState<number | null>(null);
  const connectionTestRequestRef = useRef(0);
  const activeConnectionTestRef = useRef<{ readonly requestId: number; readonly configurationRevision: number } | null>(null);
  const customEndpointBaseUrl = normalizeOpenAiCompatibleBaseUrl(setup.selfHostedBaseUrl);
  const customEndpointModel = setup.selfHostedModel.trim();
  const connectionTestConfiguration: ConnectionTestConfiguration = {
    provider: setup.provider,
    baseUrl: setup.provider === "self_hosted" ? customEndpointBaseUrl ?? "" : "",
    apiKey: setup.provider === "openrouter" ? sharedOpenRouterKey.trim()
      : setup.provider === "openai" ? setup.openaiApiKey.trim()
      : setup.provider === "anthropic" ? setup.anthropicApiKey.trim()
      : setup.provider === "self_hosted" ? setup.selfHostedApiKey.trim() : "",
    model: setup.provider === "openrouter" ? setup.openRouterModel
      : setup.provider === "openai" ? setup.openaiModel.trim()
      : setup.provider === "anthropic" ? setup.anthropicModel.trim()
      : setup.provider === "self_hosted" ? customEndpointModel : "",
    fallbackModels: setup.provider === "openrouter" ? JSON.stringify(setup.openRouterFallbackModels) : "",
    cloudSelectable: setup.provider === "cloud" && cloudSelectable,
  };
  const connectionTestConfigurationRef = useRef({ configuration: connectionTestConfiguration, revision: 0 });
  if (!configurationsMatch(connectionTestConfigurationRef.current.configuration, connectionTestConfiguration)) {
    connectionTestConfigurationRef.current = {
      configuration: connectionTestConfiguration,
      revision: connectionTestConfigurationRef.current.revision + 1,
    };
  }
  const connectionTestConfigurationRevision = connectionTestConfigurationRef.current.revision;
  const connectionTestable = setup.provider !== "managed_local" && effectiveSetup.provider === setup.provider && (setup.provider === "cloud"
    ? cloudSelectable
    : setup.provider === "self_hosted"
      ? Boolean(customEndpointBaseUrl && customEndpointModel)
      : Boolean(connectionTestConfiguration.apiKey && connectionTestConfiguration.model));
  const connectionTestRunning = runningConfigurationRevision === connectionTestConfigurationRevision;
  const connectionTestResult = taggedConnectionTestResult
    && taggedConnectionTestResult.configurationRevision === connectionTestConfigurationRevision
    ? taggedConnectionTestResult.result
    : null;

  useEffect(() => {
    return () => {
      connectionTestRequestRef.current += 1;
      activeConnectionTestRef.current = null;
    };
  }, []);

  // The "Model being used" summary is directly selectable (like the Classification
  // tab): a provider dropdown + a model dropdown that write straight to setup.
  const selectedModelValue = summaryModelValue(effectiveSetup, cloud);
  const modelOptions = effectiveSetup.provider === "openrouter"
    ? modelPickers.openRouterModelOptions.map(option => ({ value: option.id, label: option.label }))
    : summaryModelOptions(effectiveSetup, cloud, t);

  const handleProviderChange = (provider: AnalysisProvider) => {
    // Always reveal the provider's Configure card. Only commit to it as the active
    // provider once it's ready — an unconfigured provider just expands its card so
    // the user can enter its API key / settings first.
    onProviderVisible?.(provider);
    setExpandedCard(CARD_FOR_PROVIDER[provider]);
    if (providerReady(provider) && provider !== setup.provider) onChange({ ...setup, provider, selectionSource: "manual" });
  };
  const handleModelChange = (modelId: string) => {
    // cloud + custom expose a single, non-editable summary option; the custom
    // model id is edited inside the Custom endpoint card below.
    if (setup.provider === "openrouter") modelPickers.handleOpenRouterPrimaryModelChange(modelId);
    else if (setup.provider === "openai") onChange({ ...setup, openaiModel: modelId });
    else if (setup.provider === "anthropic") onChange({ ...setup, anthropicModel: modelId });
  };

  const handleToggle = (id: IntelligenceCardId) => {
    const provider = (Object.keys(CARD_FOR_PROVIDER) as AnalysisProvider[]).find(value => CARD_FOR_PROVIDER[value] === id);
    if (provider) onProviderVisible?.(provider);
    setExpandedCard(current => current === id ? null : id);
  };

  const handleTestConnection = async () => {
    if (!connectionTestable) return;
    const configuration = connectionTestConfiguration;
    const configurationRevision = connectionTestConfigurationRevision;
    if (activeConnectionTestRef.current?.configurationRevision === configurationRevision) return;
    const requestId = ++connectionTestRequestRef.current;
    activeConnectionTestRef.current = { requestId, configurationRevision };
    setRunningConfigurationRevision(configurationRevision);
    setTaggedConnectionTestResult(null);
    try {
      const result = configuration.provider === "openrouter"
        ? await testLocalAiConnection({ ...pickerSetup, provider: "openrouter_byok", openRouterApiKey: configuration.apiKey })
        : configuration.provider === "cloud"
          ? await testCloudAiConnection()
          : configuration.provider === "anthropic"
            ? await testAnthropicConnection({ apiKey: configuration.apiKey, model: configuration.model })
            : await testOpenAiCompatibleConnection({
              baseUrl: configuration.provider === "openai" ? "https://api.openai.com/v1" : configuration.baseUrl,
              apiKey: configuration.apiKey,
              model: configuration.model,
            });
      if (
        requestId === connectionTestRequestRef.current
        && connectionTestConfigurationRef.current.revision === configurationRevision
      ) {
        setTaggedConnectionTestResult({ configurationRevision, result });
      }
    } catch {
      if (
        requestId === connectionTestRequestRef.current
        && connectionTestConfigurationRef.current.revision === configurationRevision
      ) {
        setTaggedConnectionTestResult({
          configurationRevision,
          result: { kind: "error", issueKind: "provider", message: "Connection test failed." },
        });
      }
    } finally {
      if (activeConnectionTestRef.current?.requestId === requestId) {
        activeConnectionTestRef.current = null;
        setRunningConfigurationRevision(null);
      }
    }
  };

  const displayedConnectionTestResult = effectiveSetup.provider === setup.provider ? connectionTestResult : null;
  const localizedConnectionTestMessage = displayedConnectionTestResult
    ? localizeAiConnectionTestMessage(displayedConnectionTestResult.message, displayedConnectionTestResult.kind, effectiveLanguage, t)
    : effectiveSetup.provider !== setup.provider
      ? t("settings.intelligence.cloudRecovery", { provider: summarizeAnalysisSetup(setup, hasOpenRouterKey, cloud, t).providerLabel })
      : null;
  const summaryTone = displayedConnectionTestResult?.kind === "error"
    ? "error"
    : displayedConnectionTestResult?.kind === "success"
      ? "ok"
      : summary.tone;

  return (
    <div className="ai-setup-advanced__model">
      <ModelBeingUsedCard
        regionAriaLabel={t("settings.intelligence.modelBeingUsedAria")}
        heading={t("settings.ai.intelligenceRoute")}
        connectionAction={
          <AiConnectionTestAction running={connectionTestRunning} disabled={!connectionTestable} onTest={handleTestConnection} />
        }
        tone={summaryTone}
        statusLabel={summary.statusLabel}
        statusProviderLabel={summary.providerLabel}
        statusAriaLabel={t("settings.intelligence.statusAria", { provider: summary.providerLabel, model: summary.modelLabel, status: summary.statusLabel })}
        providerAriaLabel={t("settings.intelligence.providerAria")}
        providerValue={effectiveSetup.provider}
        providerOptions={providerOptions}
        onProviderChange={(value) => handleProviderChange(value as AnalysisProvider)}
        modelAriaLabel={t("settings.intelligence.modelAria")}
        modelValue={selectedModelValue}
        modelOptions={modelOptions}
        modelPlaceholder={t("settings.intelligence.selectModel")}
        onModelChange={handleModelChange}
        statusMessage={connectionTestRunning ? null : localizedConnectionTestMessage}
        statusMessageKind={displayedConnectionTestResult?.kind ?? null}
      />
      {showLocalQuality && effectiveSetup.provider === "managed_local" ? <p className="ai-model-resource-summary__quality">{t("settings.ai.localQuality")}</p> : null}
      <AiSetupConnectionDetails ariaLabel={t("settings.intelligence.providersAria")}>
        <AiSetupSectionCard idPrefix="ai-analysis" section={{ id: "openrouter", title: "OpenRouter" }} brand="openrouter" expanded={expandedCard === "openrouter"} onToggle={handleToggle}>
          <OpenRouterConnectionFields
            apiKey={sharedOpenRouterKey}
            onApiKeyChange={(value) => {
              if (onOpenRouterApiKeyChange) onOpenRouterApiKeyChange(value);
              onChange({ ...setup, ...(!onOpenRouterApiKeyChange ? { openRouterApiKey: value } : {}) });
            }}
            onChooseModels={() => modelPickers.setOpenRouterModelPickerOpen(true)}
          />
        </AiSetupSectionCard>

        <AiSetupSectionCard idPrefix="ai-analysis" section={{ id: "custom", title: t("settings.ai.customEndpoint") }} brand="custom" expanded={expandedCard === "custom"} onToggle={handleToggle}>
          <CustomEndpointSetupPanel
            baseUrl={setup.selfHostedBaseUrl}
            apiKey={setup.selfHostedApiKey}
            model={setup.selfHostedModel}
            sharingPartner="classification"
            baseUrlAriaLabel={t("settings.intelligence.endpointBaseUrlAria")}
            apiKeyAriaLabel={t("settings.intelligence.customApiKeyAria")}
            modelAriaLabel={t("settings.intelligence.endpointModelAria")}
            onBaseUrlChange={(selfHostedBaseUrl) => onChange({ ...setup, selfHostedBaseUrl })}
            onApiKeyChange={(selfHostedApiKey) => onChange({ ...setup, selfHostedApiKey })}
            onModelChange={(selfHostedModel) => onChange({ ...setup, selfHostedModel })}
          />
        </AiSetupSectionCard>

        <AiSetupSectionCard idPrefix="ai-analysis" section={{ id: "chatgpt", title: "OpenAI" }} brand="openai" expanded={expandedCard === "chatgpt"} onToggle={handleToggle}>
          <DirectProviderConnectionFields
            provider="openai"
            groupAriaLabel={t("settings.intelligence.openAiModelAria")}
            apiKey={setup.openaiApiKey}
            model={setup.openaiModel}
            defaultModel={DEFAULT_ANALYSIS_OPENAI_MODEL}
            suggestions={ANALYSIS_OPENAI_MODEL_SUGGESTIONS}
            datalistId={OPENAI_MODEL_DATALIST_ID}
            onApiKeyChange={(value) => onChange({ ...setup, openaiApiKey: value })}
            onModelChange={(value) => onChange({ ...setup, openaiModel: value })}
          />
        </AiSetupSectionCard>

        <AiSetupSectionCard idPrefix="ai-analysis" section={{ id: "anthropic", title: "Anthropic" }} brand="anthropic" expanded={expandedCard === "anthropic"} onToggle={handleToggle}>
          <DirectProviderConnectionFields
            provider="anthropic"
            groupAriaLabel={t("settings.intelligence.anthropicModelAria")}
            apiKey={setup.anthropicApiKey}
            model={setup.anthropicModel}
            defaultModel={DEFAULT_ANALYSIS_ANTHROPIC_MODEL}
            suggestions={ANALYSIS_ANTHROPIC_MODEL_SUGGESTIONS}
            datalistId={ANTHROPIC_MODEL_DATALIST_ID}
            onApiKeyChange={(value) => onChange({ ...setup, anthropicApiKey: value })}
            onModelChange={(value) => onChange({ ...setup, anthropicModel: value })}
          />
        </AiSetupSectionCard>
      </AiSetupConnectionDetails>
      <ModalPresence>
        {modelPickers.openRouterModelPickerOpen ? <OpenRouterModelDialog
          customModel={modelPickers.openRouterCustomModel}
          openRouterPrimaryModel={modelPickers.openRouterPrimaryModel}
          options={modelPickers.openRouterModelOptions}
          selectedModels={modelPickers.openRouterSelectedModels}
          onAddCustomModel={modelPickers.handleAddOpenRouterCustomModel}
          onClose={() => modelPickers.setOpenRouterModelPickerOpen(false)}
          onCustomModelChange={modelPickers.setOpenRouterCustomModel}
          onPrimaryModelChange={modelPickers.handleOpenRouterPrimaryModelChange}
          onToggleModel={modelPickers.handleOpenRouterModelToggle}
        /> : null}
      </ModalPresence>
    </div>
  );
}

function configurationsMatch(
  left: ConnectionTestConfiguration | null,
  right: ConnectionTestConfiguration | null,
): boolean {
  return Boolean(
    left
    && right
    && left.provider === right.provider
    && left.baseUrl === right.baseUrl
    && left.apiKey === right.apiKey
    && left.model === right.model
    && left.fallbackModels === right.fallbackModels
    && left.cloudSelectable === right.cloudSelectable,
  );
}

class IntelligenceProviderError extends Error {
  constructor(readonly provider: string) {
    super(`Unhandled analysis provider: ${provider}`);
    this.name = "IntelligenceProviderError";
  }
}

function assertNever(value: never): never {
  throw new IntelligenceProviderError(String(value));
}
