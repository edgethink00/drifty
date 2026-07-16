import { useState } from "react";
import type { ReactNode } from "react";

import { aiProviderBrandMark } from "./AiProviderBrandMark";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { ModelBeingUsedCard } from "./ModelBeingUsedCard";
import { type SettingsSelectOption } from "./SettingsSelect";
import { ANALYSIS_ANTHROPIC_MODEL_SUGGESTIONS, ANALYSIS_OPENAI_MODEL_SUGGESTIONS, ANALYSIS_RECOMMENDED_MODELS, DEFAULT_ANALYSIS_MODEL, DEFAULT_ANALYSIS_ANTHROPIC_MODEL, DEFAULT_ANALYSIS_OPENAI_MODEL, analysisModelDisplayLabel } from "./analysisModelSetup";
import type { AnalysisAiSetupState, AnalysisProvider } from "./analysisModelSetup";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";

const CLOUD_MANAGED_MODEL_ID = "cloud_managed";
const CUSTOM_ENDPOINT_MODEL_ID = "custom_endpoint";

export interface IntelligenceSetupPanelProps {
  readonly setup: AnalysisAiSetupState;
  readonly onChange: (next: AnalysisAiSetupState) => void;
  readonly openRouterConnected: boolean;
  readonly onConnectOpenRouter: () => void;
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

/** Each card selects a concrete analysis provider when opened. */
const PROVIDER_FOR_CARD: Record<IntelligenceCardId, AnalysisProvider> = {
  drifty: "cloud",
  openrouter: "openrouter",
  custom: "self_hosted",
  anthropic: "anthropic",
  chatgpt: "openai",
};

const CARD_FOR_PROVIDER: Record<AnalysisProvider, IntelligenceCardId> = {
  cloud: "drifty",
  openrouter: "openrouter",
  self_hosted: "custom",
  anthropic: "anthropic",
  openai: "chatgpt",
};

const ANALYSIS_MODEL_DATALIST_ID = "intelligence-analysis-model-options";
const OPENAI_MODEL_DATALIST_ID = "intelligence-openai-model-options";
const ANTHROPIC_MODEL_DATALIST_ID = "intelligence-anthropic-model-options";

type SummaryInfo = {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly statusLabel: string;
  readonly tone: "ok" | "warning";
  readonly ready: boolean;
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
        ? { providerLabel: "OpenRouter", modelLabel, statusLabel: t("settings.intelligence.connected"), tone: "ok", ready: true }
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
      const configured = setup.selfHostedBaseUrl.trim().length > 0 && setup.selfHostedModel.trim().length > 0;
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
    case "openrouter": {
      const options: SettingsSelectOption<string>[] = ANALYSIS_RECOMMENDED_MODELS.map((model) => ({ value: model.id, label: model.label }));
      const current = setup.openRouterModel.trim();
      if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: analysisModelDisplayLabel(current) });
      return options;
    }
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

export function IntelligenceSetupPanel({ setup, onChange, openRouterConnected, onConnectOpenRouter, cloudSelectable, cloudSubscribeActionLabel, cloudSubscribeActionDisabled, canManageBilling, onStartCloudSetup, onManageCloudBilling }: IntelligenceSetupPanelProps): JSX.Element {
  const { t } = useLocalization();
  const cloud: CloudBilling = { selectable: cloudSelectable, upgradeLabel: cloudSubscribeActionLabel, upgradeDisabled: cloudSubscribeActionDisabled, canManageBilling, onStartCloudSetup, onManageCloudBilling };
  // Whether a provider is ready to be the active analysis provider. Key-based
  // providers need their credentials first; Drifty Cloud is gated by subscription
  // in the model dropdown, so it always counts as "reachable" here.
  const providerReady = (provider: AnalysisProvider): boolean => {
    switch (provider) {
      case "cloud":
        return true;
      case "openrouter":
        return openRouterConnected;
      case "openai":
        return setup.openaiApiKey.trim().length > 0;
      case "anthropic":
        return setup.anthropicApiKey.trim().length > 0;
      case "self_hosted":
        return setup.selfHostedBaseUrl.trim().length > 0 && setup.selfHostedModel.trim().length > 0;
      default:
        return true;
    }
  };
  const providerOptions = [
    { value: "cloud", label: "Drifty Cloud", icon: aiProviderBrandMark("drifty", { pick: true }) },
    { value: "openrouter", label: "OpenRouter", icon: aiProviderBrandMark("openrouter", { pick: true }), muted: !providerReady("openrouter") },
    { value: "openai", label: "OpenAI", icon: aiProviderBrandMark("openai", { pick: true }), muted: !providerReady("openai") },
    { value: "anthropic", label: "Anthropic", icon: aiProviderBrandMark("anthropic", { pick: true }), muted: !providerReady("anthropic") },
    { value: "self_hosted", label: t("settings.ai.customEndpoint"), icon: aiProviderBrandMark("custom", { pick: true }), muted: !providerReady("self_hosted") },
  ] satisfies readonly SettingsSelectOption<AnalysisProvider>[];
  // Which provider card is expanded. Defaults to the active provider so the tab
  // opens focused on whatever analysis model is currently in use.
  const [expandedCard, setExpandedCard] = useState<IntelligenceCardId | null>(() => CARD_FOR_PROVIDER[setup.provider]);
  const summary = summarizeAnalysisSetup(setup, openRouterConnected, cloud, t);

  // The "Model being used" summary is directly selectable (like the Classification
  // tab): a provider dropdown + a model dropdown that write straight to setup.
  const selectedModelValue = summaryModelValue(setup, cloud);
  const modelOptions = summaryModelOptions(setup, cloud, t);

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
    if (setup.provider === "openrouter") onChange({ ...setup, provider: "openrouter", openRouterModel: modelId });
    else if (setup.provider === "openai") onChange({ ...setup, provider: "openai", openaiModel: modelId });
    else if (setup.provider === "anthropic") onChange({ ...setup, provider: "anthropic", anthropicModel: modelId });
  };

  const handleToggle = (id: IntelligenceCardId) => {
    const willExpand = expandedCard !== id;
    setExpandedCard(willExpand ? id : null);
    if (!willExpand) return;
    // Opening a card only commits to that provider once it's ready (has its keys /
    // config) — same rule as the summary dropdown, so an unconfigured provider is
    // never made active just by expanding its card to set it up.
    const provider = PROVIDER_FOR_CARD[id];
    if (provider && providerReady(provider) && provider !== setup.provider) {
      onChange({ ...setup, provider });
    }
  };

  return (
    <>
      <ModelBeingUsedCard
        regionAriaLabel={t("settings.intelligence.modelBeingUsedAria")}
        heading={t("settings.ai.modelBeingUsed")}
        tone={summary.tone}
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
      />
      <p className="ai-setup-route-description intelligence-setup-panel__hint">
        {t("settings.intelligence.description")}
      </p>

      <h4 className="ai-setup-provider-heading">{t("settings.ai.configureProviders")}</h4>

      <div className="ai-setup-choices" role="group" aria-label={t("settings.intelligence.providersAria")}>
        <IntelligenceProviderCard id="openrouter" title="OpenRouter" brandMark={aiProviderBrandMark("openrouter")} expanded={expandedCard === "openrouter"} onToggle={handleToggle}>
          <div className="ai-setup-detail" role="group" aria-label={t("settings.intelligence.openRouterModelAria")}>
            <div className="ai-setup-key-row">
              <label className="ai-setup-field">
                <span>{t("settings.ai.model")}</span>
                <input
                  className="settings-input"
                  aria-label={t("settings.intelligence.openRouterModelIdAria")}
                  list={ANALYSIS_MODEL_DATALIST_ID}
                  value={setup.openRouterModel}
                  onChange={(event) => onChange({ ...setup, provider: "openrouter", openRouterModel: event.target.value })}
                  placeholder={DEFAULT_ANALYSIS_MODEL}
                />
                <datalist id={ANALYSIS_MODEL_DATALIST_ID}>
                  {ANALYSIS_RECOMMENDED_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </datalist>
              </label>
              <button type="button" className="settings-btn ai-setup-model-action" onClick={onConnectOpenRouter}>
                {openRouterConnected ? t("settings.intelligence.connected") : t("settings.intelligence.connectOpenRouter")}
              </button>
            </div>
            <p className="ai-setup-route-description">
              {t("settings.intelligence.openRouterDescription")}
            </p>
          </div>
        </IntelligenceProviderCard>

        <IntelligenceProviderCard id="chatgpt" title="OpenAI" brandMark={aiProviderBrandMark("openai")} expanded={expandedCard === "chatgpt"} onToggle={handleToggle}>
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
        </IntelligenceProviderCard>

        <IntelligenceProviderCard id="anthropic" title="Anthropic" brandMark={aiProviderBrandMark("anthropic")} expanded={expandedCard === "anthropic"} onToggle={handleToggle}>
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
        </IntelligenceProviderCard>

        <IntelligenceProviderCard id="custom" title={t("settings.ai.customEndpoint")} brandMark={aiProviderBrandMark("custom")} expanded={expandedCard === "custom"} onToggle={handleToggle}>
          <div className="ai-setup-detail ai-setup-detail--custom" role="group" aria-label={t("settings.intelligence.customModelAria")}>
            <label className="ai-setup-field">
              <span>{t("settings.ai.baseUrl")}</span>
              <input
                className="settings-input"
                aria-label={t("settings.intelligence.endpointBaseUrlAria")}
                value={setup.selfHostedBaseUrl}
                onChange={(event) => onChange({ ...setup, provider: "self_hosted", selfHostedBaseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label className="ai-setup-field">
              <span>{t("settings.ai.model")}</span>
              <input
                className="settings-input"
                aria-label={t("settings.intelligence.endpointModelAria")}
                value={setup.selfHostedModel}
                onChange={(event) => onChange({ ...setup, provider: "self_hosted", selfHostedModel: event.target.value })}
                placeholder="gpt-5-mini"
              />
            </label>
            <ApiKeyField
              ariaLabel={t("settings.intelligence.customApiKeyAria")}
              value={setup.selfHostedApiKey}
              placeholder="sk-... (optional)"
              onValueChange={(value) => onChange({ ...setup, provider: "self_hosted", selfHostedApiKey: value })}
            />
          </div>
        </IntelligenceProviderCard>
      </div>
    </>
  );
}

type IntelligenceProviderCardProps = {
  readonly id: IntelligenceCardId;
  readonly title: string;
  readonly brandMark: ReactNode;
  readonly expanded: boolean;
  readonly children: ReactNode;
  readonly onToggle: (id: IntelligenceCardId) => void;
};

/**
 * Replica of AiSetupSectionCard's `article.ai-setup-choice` markup so the
 * Intelligence cards read identically to the Classification providers, carrying
 * a custom title + brand mark.
 */
function IntelligenceProviderCard({ id, title, brandMark, expanded, children, onToggle }: IntelligenceProviderCardProps): JSX.Element {
  const { t } = useLocalization();
  const panelId = `intelligence-provider-${id}`;
  const buttonId = `intelligence-provider-button-${id}`;

  return (
    <article className={`ai-setup-choice${expanded ? " is-expanded" : ""}`}>
      <button
        id={buttonId}
        type="button"
        className="ai-setup-choice__toggle"
        aria-label={t("settings.ai.setupRowAria", { provider: title })}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => onToggle(id)}
      >
        {brandMark}
        <span className="ai-setup-choice__copy">
          <span className="ai-setup-choice__title">{title}</span>
        </span>
        <span className="ai-setup-choice__chevron" aria-hidden="true" />
      </button>
      <CollapsiblePanel contentClassName="ai-setup-choice__panel" expanded={expanded} id={panelId} labelledBy={buttonId}>
        {children}
      </CollapsiblePanel>
    </article>
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
 * field, autocomplete-off, and a per-provider aria-label. OpenRouter keeps its
 * separate browser Connect flow and never renders a raw key here.
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

class IntelligenceProviderError extends Error {
  constructor(readonly provider: string) {
    super(`Unhandled analysis provider: ${provider}`);
    this.name = "IntelligenceProviderError";
  }
}

function assertNever(value: never): never {
  throw new IntelligenceProviderError(String(value));
}
