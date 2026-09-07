import { useEffect, useRef, useState } from "react";

import { aiProviderBrandMark } from "./AiProviderBrandMark";
import { testLocalAiConnection, testOpenAiCompatibleConnection, type AiConnectionTestResult } from "./aiConnectionTest";
import { OpenRouterConnectionFields } from "./OpenRouterSetupPanel";
import { OpenRouterModelDialog } from "./AiSetupModelDialogs";
import { ModalPresence } from "../../components/ModalPresence";
import { useAiSetupModelPickers } from "./useAiSetupModelPickers";
import { AiSetupConnectionDetails, AiSetupSectionCard } from "./AiSetupSectionCards";
import { CustomEndpointSetupPanel } from "./CustomEndpointSetupPanel";
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
  readonly onChange: (next: AnalysisAiSetupState) => void;
  readonly openRouterConnected: boolean;
  readonly openRouterApiKey?: string;
  readonly onOpenRouterApiKeyChange?: (value: string) => void;
  readonly onDialogOpenChange?: (open: boolean) => void;
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
 * "Intelligence" tab of the AI setup panel — configures the heavy analysis
 * (project pass) model. It deliberately mirrors the Classification providers
 * tab: a "Model being used" summary card on top, then a stack of expandable
 * provider cards. Every card maps to a real analysis provider: Drifty Cloud,
 * OpenRouter, direct OpenAI + Anthropic keys, and an OpenAI-compatible custom
 * endpoint.
 */
type IntelligenceCardId = "drifty" | "openrouter" | "custom" | "anthropic" | "chatgpt";

const CARD_FOR_PROVIDER: Record<AnalysisProvider, IntelligenceCardId> = {
  cloud: "drifty",
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

type CustomEndpointTestConfiguration = {
  readonly provider: AnalysisProvider;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModels: string;
};

type TaggedConnectionTestResult = {
  readonly configurationRevision: number;
  readonly result: AiConnectionTestResult;
};

function summarizeAnalysisSetup(setup: AnalysisAiSetupState, openRouterConnected: boolean, cloud: CloudBilling, t: LocalizationController["t"]): SummaryInfo {
  switch (setup.provider) {
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

export function IntelligenceSetupPanel({ setup, onChange, openRouterConnected, openRouterApiKey, onOpenRouterApiKeyChange, onDialogOpenChange, cloudSelectable, cloudSubscribeActionLabel, cloudSubscribeActionDisabled, canManageBilling, onStartCloudSetup, onManageCloudBilling }: IntelligenceSetupPanelProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const sharedOpenRouterKey = openRouterApiKey ?? setup.openRouterApiKey;
  const hasOpenRouterKey = openRouterApiKey !== undefined ? Boolean(openRouterApiKey.trim()) : Boolean(sharedOpenRouterKey.trim()) || openRouterConnected;
  const pickerSetup = { ...DEFAULT_LOCAL_AI_SETUP, openRouterModel: setup.openRouterModel, openRouterFallbackModels: setup.openRouterFallbackModels };
  const modelPickers = useAiSetupModelPickers(pickerSetup, (update) => {
    const next = typeof update === "function" ? update(pickerSetup) : update;
    onChange({ ...setup, provider: "openrouter", openRouterModel: next.openRouterModel, openRouterFallbackModels: next.openRouterFallbackModels });
  }, ANALYSIS_RECOMMENDED_MODELS);
  const cloud: CloudBilling = { selectable: cloudSelectable, upgradeLabel: cloudSubscribeActionLabel, upgradeDisabled: cloudSubscribeActionDisabled, canManageBilling, onStartCloudSetup, onManageCloudBilling };
  // Whether a provider is ready to be the active analysis provider. Key-based
  // providers need their credentials first; Drifty Cloud is gated by subscription
  // in the model dropdown, so it always counts as "reachable" here.
  const providerReady = (provider: AnalysisProvider): boolean => {
    switch (provider) {
      case "cloud":
        return true;
      case "openrouter":
        return hasOpenRouterKey;
      case "openai":
        return setup.openaiApiKey.trim().length > 0;
      case "anthropic":
        return setup.anthropicApiKey.trim().length > 0;
      case "self_hosted":
        return Boolean(normalizeOpenAiCompatibleBaseUrl(setup.selfHostedBaseUrl) && setup.selfHostedModel.trim());
      default:
        return true;
    }
  };
  const providerOptions = [
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
    onDialogOpenChange?.(expandedCard === "openrouter" || modelPickers.openRouterModelPickerOpen);
    return () => onDialogOpenChange?.(false);
  }, [expandedCard, modelPickers.openRouterModelPickerOpen, onDialogOpenChange]);
  const summary = summarizeAnalysisSetup(setup, hasOpenRouterKey, cloud, t);
  const [taggedConnectionTestResult, setTaggedConnectionTestResult] = useState<TaggedConnectionTestResult | null>(null);
  const [runningConfigurationRevision, setRunningConfigurationRevision] = useState<number | null>(null);
  const connectionTestRequestRef = useRef(0);
  const activeConnectionTestRef = useRef<{ readonly requestId: number; readonly configurationRevision: number } | null>(null);
  const customEndpointBaseUrl = normalizeOpenAiCompatibleBaseUrl(setup.selfHostedBaseUrl);
  const customEndpointModel = setup.selfHostedModel.trim();
  const customEndpointConfiguration: CustomEndpointTestConfiguration = {
    provider: setup.provider,
    baseUrl: setup.provider === "openrouter" ? "https://openrouter.ai/api/v1" : customEndpointBaseUrl ?? "",
    apiKey: setup.provider === "openrouter" ? sharedOpenRouterKey.trim() : setup.selfHostedApiKey.trim(),
    model: setup.provider === "openrouter" ? setup.openRouterModel : customEndpointModel,
    fallbackModels: JSON.stringify(setup.openRouterFallbackModels),
  };
  const customEndpointConfigurationRef = useRef({ configuration: customEndpointConfiguration, revision: 0 });
  if (!configurationsMatch(customEndpointConfigurationRef.current.configuration, customEndpointConfiguration)) {
    customEndpointConfigurationRef.current = {
      configuration: customEndpointConfiguration,
      revision: customEndpointConfigurationRef.current.revision + 1,
    };
  }
  const customEndpointConfigurationRevision = customEndpointConfigurationRef.current.revision;
  const connectionTestable = setup.provider === "openrouter"
    ? Boolean(sharedOpenRouterKey.trim())
    : setup.provider === "self_hosted" && Boolean(customEndpointBaseUrl && customEndpointModel);
  const connectionTestRunning = runningConfigurationRevision === customEndpointConfigurationRevision;
  const connectionTestResult = taggedConnectionTestResult
    && taggedConnectionTestResult.configurationRevision === customEndpointConfigurationRevision
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
  const selectedModelValue = summaryModelValue(setup, cloud);
  const modelOptions = setup.provider === "openrouter"
    ? modelPickers.openRouterModelOptions.map(option => ({ value: option.id, label: option.label }))
    : summaryModelOptions(setup, cloud, t);

  const handleProviderChange = (provider: AnalysisProvider) => {
    // Always reveal the provider's Configure card. Only commit to it as the active
    // provider once it's ready — an unconfigured provider just expands its card so
    // the user can enter its API key / settings first.
    setExpandedCard(CARD_FOR_PROVIDER[provider]);
    if (providerReady(provider) && provider !== setup.provider) onChange({ ...setup, provider });
  };
  const handleModelChange = (modelId: string) => {
    // cloud + custom expose a single, non-editable summary option; the custom
    // model id is edited inside the Custom endpoint card below.
    if (setup.provider === "openrouter") modelPickers.handleOpenRouterPrimaryModelChange(modelId);
    else if (setup.provider === "openai") onChange({ ...setup, provider: "openai", openaiModel: modelId });
    else if (setup.provider === "anthropic") onChange({ ...setup, provider: "anthropic", anthropicModel: modelId });
  };

  const handleToggle = (id: IntelligenceCardId) => {
    setExpandedCard(current => current === id ? null : id);
  };

  const handleTestConnection = async () => {
    if (!connectionTestable) return;
    const configuration = customEndpointConfiguration;
    const configurationRevision = customEndpointConfigurationRevision;
    if (activeConnectionTestRef.current?.configurationRevision === configurationRevision) return;
    const requestId = ++connectionTestRequestRef.current;
    activeConnectionTestRef.current = { requestId, configurationRevision };
    setRunningConfigurationRevision(configurationRevision);
    setTaggedConnectionTestResult(null);
    try {
      const result = configuration.provider === "openrouter"
        ? await testLocalAiConnection({ ...pickerSetup, provider: "openrouter_byok", openRouterApiKey: configuration.apiKey })
        : await testOpenAiCompatibleConnection({
        baseUrl: configuration.baseUrl,
        apiKey: configuration.apiKey,
        model: configuration.model,
      });
      if (
        requestId === connectionTestRequestRef.current
        && customEndpointConfigurationRef.current.revision === configurationRevision
      ) {
        setTaggedConnectionTestResult({ configurationRevision, result });
      }
    } catch {
      if (
        requestId === connectionTestRequestRef.current
        && customEndpointConfigurationRef.current.revision === configurationRevision
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

  const localizedConnectionTestMessage = connectionTestResult
    ? localizeAiConnectionTestMessage(connectionTestResult.message, connectionTestResult.kind, effectiveLanguage, t)
    : null;
  const summaryTone = connectionTestResult?.kind === "error"
    ? "error"
    : connectionTestResult?.kind === "success"
      ? "ok"
      : summary.tone;

  return (
    <>
      <ModelBeingUsedCard
        regionAriaLabel={t("settings.intelligence.modelBeingUsedAria")}
        heading={t("settings.ai.intelligenceRoute")}
        headingAction={setup.provider === "self_hosted" || setup.provider === "openrouter" ? (
          <button
            type="button"
            className="settings-btn ai-setup-current-model__test"
            aria-label={connectionTestRunning ? t("settings.ai.testing") : t("settings.ai.testConnectionAria")}
            aria-busy={connectionTestRunning ? "true" : undefined}
            disabled={connectionTestRunning || !connectionTestable}
            onClick={() => void handleTestConnection()}
          >
            {connectionTestRunning ? t("settings.ai.testing") : t("settings.ai.testConnection")}
          </button>
        ) : null}
        tone={summaryTone}
        statusLabel={summary.statusLabel}
        statusProviderLabel={summary.providerLabel}
        statusAriaLabel={t("settings.intelligence.statusAria", { provider: summary.providerLabel, model: summary.modelLabel, status: summary.statusLabel })}
        providerAriaLabel={t("settings.intelligence.providerAria")}
        providerValue={setup.provider}
        providerOptions={providerOptions}
        onProviderChange={(value) => handleProviderChange(value as AnalysisProvider)}
        modelAriaLabel={t("settings.intelligence.modelAria")}
        modelValue={selectedModelValue}
        modelOptions={modelOptions}
        modelPlaceholder={t("settings.intelligence.selectModel")}
        onModelChange={handleModelChange}
        statusMessage={localizedConnectionTestMessage}
        statusMessageKind={connectionTestResult?.kind ?? null}
      />
      <AiSetupConnectionDetails ariaLabel={t("settings.intelligence.providersAria")}>
        <AiSetupSectionCard section={{ id: "openrouter", title: "OpenRouter" }} brand="openrouter" expanded={expandedCard === "openrouter"} onToggle={handleToggle}>
          <OpenRouterConnectionFields
            apiKey={sharedOpenRouterKey}
            onApiKeyChange={(value) => {
              if (onOpenRouterApiKeyChange) onOpenRouterApiKeyChange(value);
              onChange({ ...setup, provider: "openrouter", ...(!onOpenRouterApiKeyChange ? { openRouterApiKey: value } : {}) });
            }}
            onChooseModels={() => modelPickers.setOpenRouterModelPickerOpen(true)}
          />
        </AiSetupSectionCard>

        <AiSetupSectionCard section={{ id: "custom", title: t("settings.ai.customEndpoint") }} brand="custom" expanded={expandedCard === "custom"} onToggle={handleToggle}>
          <CustomEndpointSetupPanel
            baseUrl={setup.selfHostedBaseUrl}
            apiKey={setup.selfHostedApiKey}
            model={setup.selfHostedModel}
            sharingPartner="classification"
            baseUrlAriaLabel={t("settings.intelligence.endpointBaseUrlAria")}
            apiKeyAriaLabel={t("settings.intelligence.customApiKeyAria")}
            modelAriaLabel={t("settings.intelligence.endpointModelAria")}
            onBaseUrlChange={(selfHostedBaseUrl) => onChange({ ...setup, provider: "self_hosted", selfHostedBaseUrl })}
            onApiKeyChange={(selfHostedApiKey) => onChange({ ...setup, provider: "self_hosted", selfHostedApiKey })}
            onModelChange={(selfHostedModel) => onChange({ ...setup, provider: "self_hosted", selfHostedModel })}
          />
        </AiSetupSectionCard>

        <AiSetupSectionCard section={{ id: "chatgpt", title: "OpenAI" }} brand="openai" expanded={expandedCard === "chatgpt"} onToggle={handleToggle}>
          <div className="ai-setup-detail ai-setup-detail--custom" role="group" aria-label={t("settings.intelligence.openAiModelAria")}>
            <ApiKeyField
              ariaLabel={t("settings.intelligence.openAiApiKeyAria")}
              value={setup.openaiApiKey}
              placeholder="sk-..."
              onValueChange={(value) => onChange({ ...setup, provider: "openai", openaiApiKey: value })}
            />
            <label className="ai-setup-field">
              <span>{t("settings.ai.model")}</span>
              <input
                className="settings-input"
                aria-label={t("settings.intelligence.openAiModelIdAria")}
                list={OPENAI_MODEL_DATALIST_ID}
                value={setup.openaiModel}
                onChange={(event) => onChange({ ...setup, provider: "openai", openaiModel: event.target.value })}
                placeholder={DEFAULT_ANALYSIS_OPENAI_MODEL}
              />
              <datalist id={OPENAI_MODEL_DATALIST_ID}>
                {ANALYSIS_OPENAI_MODEL_SUGGESTIONS.map((model) => (
                  <option key={model} value={model}>
                    {analysisModelDisplayLabel(model)}
                  </option>
                ))}
              </datalist>
            </label>
            <p className="ai-setup-route-description">
              {t("settings.intelligence.openAiDescription")}
            </p>
          </div>
        </AiSetupSectionCard>

        <AiSetupSectionCard section={{ id: "anthropic", title: "Anthropic" }} brand="anthropic" expanded={expandedCard === "anthropic"} onToggle={handleToggle}>
          <div className="ai-setup-detail ai-setup-detail--custom" role="group" aria-label={t("settings.intelligence.anthropicModelAria")}>
            <ApiKeyField
              ariaLabel={t("settings.intelligence.anthropicApiKeyAria")}
              value={setup.anthropicApiKey}
              placeholder="sk-ant-..."
              onValueChange={(value) => onChange({ ...setup, provider: "anthropic", anthropicApiKey: value })}
            />
            <label className="ai-setup-field">
              <span>{t("settings.ai.model")}</span>
              <input
                className="settings-input"
                aria-label={t("settings.intelligence.anthropicModelIdAria")}
                list={ANTHROPIC_MODEL_DATALIST_ID}
                value={setup.anthropicModel}
                onChange={(event) => onChange({ ...setup, provider: "anthropic", anthropicModel: event.target.value })}
                placeholder={DEFAULT_ANALYSIS_ANTHROPIC_MODEL}
              />
              <datalist id={ANTHROPIC_MODEL_DATALIST_ID}>
                {ANALYSIS_ANTHROPIC_MODEL_SUGGESTIONS.map((model) => (
                  <option key={model} value={model}>
                    {analysisModelDisplayLabel(model)}
                  </option>
                ))}
              </datalist>
            </label>
            <p className="ai-setup-route-description">
              {t("settings.intelligence.anthropicDescription")}
            </p>
          </div>
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
    </>
  );
}

type ApiKeyFieldProps = {
  readonly ariaLabel: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
};

/**
 * Shared API-key input for the direct-key providers (Custom endpoint, OpenAI,
 * Anthropic) so all three read identically: same "API key" label, password
 * field, autocomplete-off, and a per-provider aria-label. OpenRouter reuses
 * the Classification fields and its shared Keychain-backed key.
 */
function ApiKeyField({ ariaLabel, value, onValueChange, placeholder = "sk-..." }: ApiKeyFieldProps): JSX.Element {
  const { t } = useLocalization();
  return (
    <label className="ai-setup-field">
      <span>{t("settings.intelligence.apiKey")}</span>
      <input
        className="settings-input"
        type="password"
        autoComplete="off"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function configurationsMatch(
  left: CustomEndpointTestConfiguration | null,
  right: CustomEndpointTestConfiguration | null,
): boolean {
  return Boolean(
    left
    && right
    && left.provider === right.provider
    && left.baseUrl === right.baseUrl
    && left.apiKey === right.apiKey
    && left.model === right.model
    && left.fallbackModels === right.fallbackModels,
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
