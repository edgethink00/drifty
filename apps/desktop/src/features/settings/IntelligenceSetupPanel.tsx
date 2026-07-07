import { useState } from "react";
import type { ReactNode } from "react";

import driftyLogoUrl from "../../assets/drifty-icon.png";
import openRouterLogoUrl from "../../assets/openrouter-logo.png";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { ModelBeingUsedCard } from "./ModelBeingUsedCard";
import { type SettingsSelectOption } from "./SettingsSelect";
import { ANALYSIS_RECOMMENDED_MODELS, DEFAULT_ANALYSIS_MODEL, DEFAULT_ANALYSIS_ANTHROPIC_MODEL, DEFAULT_ANALYSIS_OPENAI_MODEL } from "./analysisModelSetup";
import type { AnalysisAiSetupState, AnalysisProvider } from "./analysisModelSetup";

const CLOUD_MANAGED_MODEL_ID = "cloud_managed";
const CUSTOM_ENDPOINT_MODEL_ID = "custom_endpoint";
const OPENAI_DIRECT_MODEL_ID = "openai_direct";
const ANTHROPIC_DIRECT_MODEL_ID = "anthropic_direct";

// Brand-recognizable accent tints for the provider dropdown dots (OpenAI teal,
// Anthropic clay). The provider cards carry the full SVG brand marks below.
const OPENAI_BRAND_COLOR = "#10a37f";
const ANTHROPIC_BRAND_COLOR = "#d97757";

const ANALYSIS_PROVIDER_OPTIONS = [
  { value: "cloud", label: "Drifty Cloud", iconSrc: driftyLogoUrl },
  { value: "openrouter", label: "OpenRouter", iconSrc: openRouterLogoUrl },
  { value: "openai", label: "OpenAI", accentColor: OPENAI_BRAND_COLOR },
  { value: "anthropic", label: "Anthropic", accentColor: ANTHROPIC_BRAND_COLOR },
  { value: "self_hosted", label: "Custom endpoint", accentColor: "var(--accent)" },
] satisfies readonly SettingsSelectOption<AnalysisProvider>[];

export interface IntelligenceSetupPanelProps {
  readonly setup: AnalysisAiSetupState;
  readonly onChange: (next: AnalysisAiSetupState) => void;
  readonly openRouterConnected: boolean;
  readonly onConnectOpenRouter: () => void;
}

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

type SummaryInfo = {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly statusLabel: string;
  readonly tone: "ok" | "warning";
  readonly ready: boolean;
};

function summarizeAnalysisSetup(setup: AnalysisAiSetupState, openRouterConnected: boolean): SummaryInfo {
  switch (setup.provider) {
    case "cloud":
      return { providerLabel: "Drifty Cloud", modelLabel: "Managed by Drifty", statusLabel: "Available", tone: "ok", ready: true };
    case "openrouter": {
      const modelLabel = setup.openRouterModel.trim() || DEFAULT_ANALYSIS_MODEL;
      return openRouterConnected
        ? { providerLabel: "OpenRouter", modelLabel, statusLabel: "Connected", tone: "ok", ready: true }
        : { providerLabel: "OpenRouter", modelLabel, statusLabel: "Needs setup", tone: "warning", ready: false };
    }
    case "openai": {
      const configured = setup.openaiApiKey.trim().length > 0 && setup.openaiModel.trim().length > 0;
      const modelLabel = setup.openaiModel.trim() || "Not set";
      return configured
        ? { providerLabel: "OpenAI", modelLabel, statusLabel: "Configured", tone: "ok", ready: true }
        : { providerLabel: "OpenAI", modelLabel, statusLabel: "Needs setup", tone: "warning", ready: false };
    }
    case "anthropic": {
      const configured = setup.anthropicApiKey.trim().length > 0 && setup.anthropicModel.trim().length > 0;
      const modelLabel = setup.anthropicModel.trim() || "Not set";
      return configured
        ? { providerLabel: "Anthropic", modelLabel, statusLabel: "Configured", tone: "ok", ready: true }
        : { providerLabel: "Anthropic", modelLabel, statusLabel: "Needs setup", tone: "warning", ready: false };
    }
    case "self_hosted": {
      const configured = setup.selfHostedBaseUrl.trim().length > 0 && setup.selfHostedModel.trim().length > 0;
      const modelLabel = setup.selfHostedModel.trim() || "Not set";
      return configured
        ? { providerLabel: "Custom endpoint", modelLabel, statusLabel: "Configured", tone: "ok", ready: true }
        : { providerLabel: "Custom endpoint", modelLabel, statusLabel: "Needs setup", tone: "warning", ready: false };
    }
    default:
      return assertNever(setup.provider);
  }
}

/** The summary model dropdown's current value for each provider. */
function summaryModelValue(setup: AnalysisAiSetupState): string {
  switch (setup.provider) {
    case "cloud":
      return CLOUD_MANAGED_MODEL_ID;
    case "openrouter":
      return setup.openRouterModel.trim() || DEFAULT_ANALYSIS_MODEL;
    case "openai":
      return OPENAI_DIRECT_MODEL_ID;
    case "anthropic":
      return ANTHROPIC_DIRECT_MODEL_ID;
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
function summaryModelOptions(setup: AnalysisAiSetupState): SettingsSelectOption<string>[] {
  switch (setup.provider) {
    case "cloud":
      return [{ value: CLOUD_MANAGED_MODEL_ID, label: "Managed by Drifty" }];
    case "openrouter": {
      const options: SettingsSelectOption<string>[] = ANALYSIS_RECOMMENDED_MODELS.map((model) => ({ value: model.id, label: model.label }));
      const current = setup.openRouterModel.trim();
      if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: current });
      return options;
    }
    case "openai":
      return [{ value: OPENAI_DIRECT_MODEL_ID, label: setup.openaiModel.trim() || "OpenAI" }];
    case "anthropic":
      return [{ value: ANTHROPIC_DIRECT_MODEL_ID, label: setup.anthropicModel.trim() || "Anthropic" }];
    case "self_hosted":
      return [{ value: CUSTOM_ENDPOINT_MODEL_ID, label: setup.selfHostedModel.trim() || "Custom endpoint" }];
    default:
      return assertNever(setup.provider);
  }
}

export function IntelligenceSetupPanel({ setup, onChange, openRouterConnected, onConnectOpenRouter }: IntelligenceSetupPanelProps): JSX.Element {
  // Which provider card is expanded. Defaults to the active provider so the tab
  // opens focused on whatever analysis model is currently in use.
  const [expandedCard, setExpandedCard] = useState<IntelligenceCardId | null>(() => CARD_FOR_PROVIDER[setup.provider]);
  const summary = summarizeAnalysisSetup(setup, openRouterConnected);

  // The "Model being used" summary is directly selectable (like the Classification
  // tab): a provider dropdown + a model dropdown that write straight to setup.
  const selectedModelValue = summaryModelValue(setup);
  const modelOptions = summaryModelOptions(setup);

  const handleProviderChange = (provider: AnalysisProvider) => {
    setExpandedCard(CARD_FOR_PROVIDER[provider]);
    if (provider !== setup.provider) onChange({ ...setup, provider });
  };
  const handleModelChange = (modelId: string) => {
    // cloud + custom expose a single, non-editable summary option; the custom
    // model id is edited inside the Custom endpoint card below.
    if (setup.provider === "openrouter") onChange({ ...setup, provider: "openrouter", openRouterModel: modelId });
  };

  const handleToggle = (id: IntelligenceCardId) => {
    const willExpand = expandedCard !== id;
    setExpandedCard(willExpand ? id : null);
    if (!willExpand) return;
    // Selecting (opening) a real provider card sets it as the analysis provider.
    // Mockup cards have no provider mapping, so they never mutate setup.
    const provider = PROVIDER_FOR_CARD[id];
    if (provider && provider !== setup.provider) {
      onChange({ ...setup, provider });
    }
  };

  return (
    <>
      <ModelBeingUsedCard
        regionAriaLabel="Analysis model being used"
        heading="Model being used"
        tone={summary.tone}
        statusLabel={summary.statusLabel}
        statusProviderLabel={summary.providerLabel}
        statusAriaLabel={`Analysis model: ${summary.providerLabel}, ${summary.modelLabel}, ${summary.statusLabel}`}
        providerAriaLabel="Analysis provider"
        providerValue={setup.provider}
        providerOptions={ANALYSIS_PROVIDER_OPTIONS}
        onProviderChange={(value) => handleProviderChange(value as AnalysisProvider)}
        modelAriaLabel="Analysis model"
        modelValue={selectedModelValue}
        modelOptions={modelOptions}
        onModelChange={handleModelChange}
      />
      <p className="ai-setup-route-description intelligence-setup-panel__hint">
        This model runs the heavy project pass — it groups your whole day into projects and corrects live labels with full-day context. Use a strong model; we recommend GPT-5 mini.
      </p>

      <h4 className="ai-setup-provider-heading">Configure providers</h4>

      <div className="ai-setup-choices" role="group" aria-label="Analysis model providers">
        <IntelligenceProviderCard id="drifty" title="Drifty Cloud" brandMark={<DriftyBrandMark />} expanded={expandedCard === "drifty"} onToggle={handleToggle}>
          <div className="ai-setup-detail" role="group" aria-label="Drifty Cloud analysis model">
            <p className="ai-setup-route-description">Drifty Cloud provides the analysis model. No configuration needed — a strong project-pass model is included with your plan.</p>
          </div>
        </IntelligenceProviderCard>

        <IntelligenceProviderCard id="openrouter" title="OpenRouter" brandMark={<OpenRouterBrandMark />} expanded={expandedCard === "openrouter"} onToggle={handleToggle}>
          <div className="ai-setup-detail" role="group" aria-label="OpenRouter analysis model">
            <div className="ai-setup-key-row">
              <label className="ai-setup-field">
                <span>Model</span>
                <input
                  className="settings-input"
                  aria-label="OpenRouter model id"
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
                {openRouterConnected ? "Connected" : "Connect OpenRouter"}
              </button>
            </div>
            <p className="ai-setup-route-description">
              Pick a recommended model or type any OpenRouter model id. Connecting provisions a scoped key with a browser sign-in — your key is never shown here.
            </p>
          </div>
        </IntelligenceProviderCard>

        <IntelligenceProviderCard id="custom" title="Custom endpoint" brandMark={<CustomBrandMark />} expanded={expandedCard === "custom"} onToggle={handleToggle}>
          <div className="ai-setup-detail ai-setup-detail--custom" role="group" aria-label="Custom endpoint analysis model">
            <label className="ai-setup-field">
              <span>Base URL</span>
              <input
                className="settings-input"
                aria-label="Analysis endpoint base URL"
                value={setup.selfHostedBaseUrl}
                onChange={(event) => onChange({ ...setup, provider: "self_hosted", selfHostedBaseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label className="ai-setup-field">
              <span>Model</span>
              <input
                className="settings-input"
                aria-label="Analysis endpoint model"
                value={setup.selfHostedModel}
                onChange={(event) => onChange({ ...setup, provider: "self_hosted", selfHostedModel: event.target.value })}
                placeholder="gpt-5-mini"
              />
            </label>
            <ApiKeyField
              ariaLabel="Custom endpoint API key"
              value={setup.selfHostedApiKey}
              placeholder="sk-... (optional)"
              onValueChange={(value) => onChange({ ...setup, provider: "self_hosted", selfHostedApiKey: value })}
            />
          </div>
        </IntelligenceProviderCard>

        <IntelligenceProviderCard id="chatgpt" title="OpenAI" brandMark={<OpenAiBrandMark />} expanded={expandedCard === "chatgpt"} onToggle={handleToggle}>
          <div className="ai-setup-detail ai-setup-detail--custom" role="group" aria-label="OpenAI analysis model">
            <ApiKeyField
              ariaLabel="OpenAI API key"
              value={setup.openaiApiKey}
              placeholder="sk-..."
              onValueChange={(value) => onChange({ ...setup, provider: "openai", openaiApiKey: value })}
            />
            <label className="ai-setup-field">
              <span>Model</span>
              <input
                className="settings-input"
                aria-label="OpenAI model id"
                value={setup.openaiModel}
                onChange={(event) => onChange({ ...setup, provider: "openai", openaiModel: event.target.value })}
                placeholder={DEFAULT_ANALYSIS_OPENAI_MODEL}
              />
            </label>
            <p className="ai-setup-route-description">
              Direct OpenAI key. Uses OpenAI's chat API — your key is sent only to api.openai.com and never leaves this device otherwise.
            </p>
          </div>
        </IntelligenceProviderCard>

        <IntelligenceProviderCard id="anthropic" title="Anthropic" brandMark={<AnthropicBrandMark />} expanded={expandedCard === "anthropic"} onToggle={handleToggle}>
          <div className="ai-setup-detail ai-setup-detail--custom" role="group" aria-label="Anthropic analysis model">
            <ApiKeyField
              ariaLabel="Anthropic API key"
              value={setup.anthropicApiKey}
              placeholder="sk-ant-..."
              onValueChange={(value) => onChange({ ...setup, provider: "anthropic", anthropicApiKey: value })}
            />
            <label className="ai-setup-field">
              <span>Model</span>
              <input
                className="settings-input"
                aria-label="Anthropic model id"
                value={setup.anthropicModel}
                onChange={(event) => onChange({ ...setup, provider: "anthropic", anthropicModel: event.target.value })}
                placeholder={DEFAULT_ANALYSIS_ANTHROPIC_MODEL}
              />
            </label>
            <p className="ai-setup-route-description">
              Direct Anthropic key. Uses Anthropic's Messages API — your key is sent only to api.anthropic.com and never leaves this device otherwise.
            </p>
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
  const panelId = `intelligence-provider-${id}`;
  const buttonId = `intelligence-provider-button-${id}`;

  return (
    <article className={`ai-setup-choice${expanded ? " is-expanded" : ""}`}>
      <button
        id={buttonId}
        type="button"
        className="ai-setup-choice__toggle"
        aria-label={`${title} setup row`}
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
  return (
    <label className="ai-setup-field">
      <span>API key</span>
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

function DriftyBrandMark(): JSX.Element {
  return (
    <span className="ai-setup-brand-mark ai-setup-brand-mark--drifty" aria-hidden="true">
      <img src={driftyLogoUrl} alt="" />
    </span>
  );
}

function OpenRouterBrandMark(): JSX.Element {
  return (
    <span className="ai-setup-brand-mark ai-setup-brand-mark--openrouter" aria-hidden="true">
      <img src={openRouterLogoUrl} alt="" />
    </span>
  );
}

function CustomBrandMark(): JSX.Element {
  return (
    <span className="ai-setup-brand-mark ai-setup-brand-mark--custom" aria-hidden="true">
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M5 6.4h6.8a3.6 3.6 0 0 1 0 7.2H8.2" />
        <path d="M8.2 9.9h6.8" />
        <path d="M8.2 13.6a3.6 3.6 0 0 1 0-7.2h3.6" />
      </svg>
    </span>
  );
}

function OpenAiBrandMark(): JSX.Element {
  // OpenAI's six-fold interlocking knot/flower mark (official logo path).
  return (
    <span className="ai-setup-brand-mark ai-setup-brand-mark--openai" aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9a6.0651 6.0651 0 0 0-4.5972-2.9088 5.9847 5.9847 0 0 0-3.9977 2.9A6.0462 6.0462 0 0 0 1.8853 6.4939a5.9847 5.9847 0 0 0 .7367 7.0965 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5142 2.9002A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997z" />
      </svg>
    </span>
  );
}

function AnthropicBrandMark(): JSX.Element {
  // Anthropic's angular "A" burst mark (official corporate logo path).
  return (
    <span className="ai-setup-brand-mark ai-setup-brand-mark--anthropic" aria-hidden="true">
      <svg viewBox="0 0 46 32" aria-hidden="true" focusable="false">
        <path d="M32.73 0h-6.94l12.65 32h6.94L32.73 0ZM12.65 0 0 32h7.08l2.59-6.71h13.23L25.49 32h7.08L19.92 0h-7.27Zm-.65 19.34 4.32-11.22 4.33 11.22H12Z" />
      </svg>
    </span>
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
