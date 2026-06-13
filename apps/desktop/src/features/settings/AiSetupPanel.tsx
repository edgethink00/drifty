import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";

import { IndividualPlanCards, type BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingInterval } from "../billing/billingService";
import {
  OPENROUTER_RECOMMENDED_MODELS,
  SELF_HOSTED_RECOMMENDED_MODELS,
  isForbiddenOpenRouterModel,
  isRecommendedOpenRouterModel,
  isRecommendedSelfHostedModel,
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
  uniqueOpenRouterModels,
} from "./localAiSetup";
import type { LocalAiSetupState } from "./localAiSetup";

const AI_SETUP_SECTIONS = [
  { id: "cloud", label: "Cloud" },
  { id: "local", label: "BYOK(OpenRouter)" },
  { id: "ollama", label: "Local (Ollama)" },
] as const;

type AiSetupSection = (typeof AI_SETUP_SECTIONS)[number]["id"];

type CloudSetupHandler = (billingInterval?: BillingInterval) => void | Promise<void>;

type AiSetupPanelProps = {
  readonly aiServerStatusLabel: string;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementError: string | null;
  readonly billingPlansDisabled: boolean;
  readonly cloudStatusLabel: string;
  readonly currentBillingPlan: BillingPlanId | null;
  readonly localAiSetup: LocalAiSetupState;
  readonly shouldShowCloudCheckoutPlans: boolean;
  readonly onDialogOpenChange: (open: boolean) => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onStartCloudSetup: CloudSetupHandler;
};

function providerForSection(section: AiSetupSection): LocalAiSetupState["provider"] | null {
  if (section === "local") return "openrouter_byok";
  if (section === "ollama") return "self_hosted";
  return null;
}

export function AiSetupPanel({
  aiServerStatusLabel,
  billingCheckoutLoadingInterval,
  billingEntitlementError,
  billingPlansDisabled,
  cloudStatusLabel,
  currentBillingPlan,
  localAiSetup,
  shouldShowCloudCheckoutPlans,
  onDialogOpenChange,
  onLocalAiSetupChange,
  onStartCloudSetup,
}: AiSetupPanelProps) {
  const [activeSection, setActiveSection] = useState<AiSetupSection>("cloud");
  const [openRouterModelPickerOpen, setOpenRouterModelPickerOpen] = useState(false);
  const [openRouterCustomModel, setOpenRouterCustomModel] = useState("");
  const [selfHostedModelPickerOpen, setSelfHostedModelPickerOpen] = useState(false);
  const [selfHostedCustomModel, setSelfHostedCustomModel] = useState("");

  const openRouterPrimaryModel = normalizeOpenRouterPrimaryModel(localAiSetup.openRouterModel);
  const openRouterFallbackModels = useMemo(
    () => normalizeOpenRouterFallbackModels(openRouterPrimaryModel, localAiSetup.openRouterFallbackModels),
    [localAiSetup.openRouterFallbackModels, openRouterPrimaryModel],
  );
  const openRouterSelectedModels = useMemo(
    () => uniqueOpenRouterModels([openRouterPrimaryModel, ...openRouterFallbackModels]),
    [openRouterFallbackModels, openRouterPrimaryModel],
  );
  const openRouterCustomSelectedModels = openRouterSelectedModels.filter((model) => !isRecommendedOpenRouterModel(model));
  const openRouterModelOptions = useMemo(
    () => [
      ...OPENROUTER_RECOMMENDED_MODELS,
      ...openRouterCustomSelectedModels.map((model) => ({ id: model, label: model, detail: "Other model" })),
    ],
    [openRouterCustomSelectedModels],
  );
  const openRouterSelectionSummary = openRouterFallbackModels.length > 0
    ? `${openRouterPrimaryModel} + ${openRouterFallbackModels.length} fallback${openRouterFallbackModels.length === 1 ? "" : "s"}`
    : openRouterPrimaryModel;
  const selfHostedSelectedModel = localAiSetup.selfHostedModel.trim();
  const selfHostedCustomSelectedModels = selfHostedSelectedModel && !isRecommendedSelfHostedModel(selfHostedSelectedModel) ? [selfHostedSelectedModel] : [];
  const selfHostedModelOptions = useMemo(
    () => [
      ...SELF_HOSTED_RECOMMENDED_MODELS,
      ...selfHostedCustomSelectedModels.map((model) => ({ id: model, label: model, detail: "Other model" })),
    ],
    [selfHostedCustomSelectedModels],
  );
  const selfHostedModelSummary = selfHostedSelectedModel || "No model selected";

  useEffect(() => {
    onDialogOpenChange(openRouterModelPickerOpen || selfHostedModelPickerOpen);
    return () => onDialogOpenChange(false);
  }, [onDialogOpenChange, openRouterModelPickerOpen, selfHostedModelPickerOpen]);

  const handleSectionChange = (section: AiSetupSection) => {
    setActiveSection(section);
    const provider = providerForSection(section);
    if (provider) onLocalAiSetupChange((current) => ({ ...current, provider }));
  };

  const handleOpenRouterModelToggle = (model: string, selected: boolean) => {
    const modelId = model.trim();
    if (!modelId) return;

    onLocalAiSetupChange((current) => {
      const primaryModel = normalizeOpenRouterPrimaryModel(current.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(primaryModel, current.openRouterFallbackModels);
      if (selected) {
        if (modelId === primaryModel || fallbackModels.includes(modelId)) return current;
        return { ...current, openRouterFallbackModels: [...fallbackModels, modelId] };
      }

      if (modelId === primaryModel) {
        const [nextPrimaryModel, ...nextFallbackModels] = fallbackModels;
        if (!nextPrimaryModel) return current;
        return { ...current, openRouterModel: nextPrimaryModel, openRouterFallbackModels: nextFallbackModels };
      }

      return { ...current, openRouterFallbackModels: fallbackModels.filter((fallbackModel) => fallbackModel !== modelId) };
    });
  };

  const handleOpenRouterPrimaryModelChange = (model: string) => {
    const modelId = model.trim();
    if (!modelId) return;

    onLocalAiSetupChange((current) => {
      const primaryModel = normalizeOpenRouterPrimaryModel(current.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(primaryModel, current.openRouterFallbackModels);
      const selectedModels = uniqueOpenRouterModels([primaryModel, ...fallbackModels, modelId]);
      return { ...current, openRouterModel: modelId, openRouterFallbackModels: selectedModels.filter((selectedModel) => selectedModel !== modelId) };
    });
  };

  const handleAddOpenRouterCustomModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const modelId = openRouterCustomModel.trim();
    if (!modelId || isForbiddenOpenRouterModel(modelId)) return;

    onLocalAiSetupChange((current) => {
      const primaryModel = normalizeOpenRouterPrimaryModel(current.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(primaryModel, current.openRouterFallbackModels);
      if (modelId === primaryModel || fallbackModels.includes(modelId)) return current;
      return { ...current, openRouterFallbackModels: [...fallbackModels, modelId] };
    });
    setOpenRouterCustomModel("");
  };

  const handleSelfHostedModelChange = (model: string) => {
    const modelId = model.trim();
    if (!modelId) return;
    onLocalAiSetupChange((current) => ({ ...current, selfHostedModel: modelId }));
  };

  const handleAddSelfHostedCustomModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const modelId = selfHostedCustomModel.trim();
    if (!modelId) return;
    onLocalAiSetupChange((current) => ({ ...current, selfHostedModel: modelId }));
    setSelfHostedCustomModel("");
  };

  const sectionPanels = {
    cloud: (
      <div className="ai-setup-section-panel__body">
        <div className="settings-row settings-row--fallback settings-row--cloud-pricing" role="group" aria-label="Drifty Cloud pricing">
          <div className="settings-row__summary">
            <div className="lbl">Drifty Cloud</div>
            <span className="chip" aria-label={`Drifty Cloud status: ${cloudStatusLabel}`}>{aiServerStatusLabel}</span>
            {billingEntitlementError ? <span className="settings-row__message">{billingEntitlementError}</span> : null}
          </div>
          <div className="ctrl settings-row__actions">
            <IndividualPlanCards
              currentPlan={currentBillingPlan}
              disabled={billingPlansDisabled}
              loadingInterval={billingCheckoutLoadingInterval}
              mode={shouldShowCloudCheckoutPlans ? "checkout" : "display"}
              onSelectPlan={(billingInterval) => void onStartCloudSetup(billingInterval)}
            />
          </div>
        </div>
      </div>
    ),
    local: (
      <div className="ai-setup-section-panel__body">
        <div className="cloud-overview__header">
          <div>
            <h3>OpenRouter BYOK</h3>
          </div>
          <span className="chip">Saved on this Mac</span>
        </div>
        <div className="settings-row settings-row--fallback settings-row--provider-card" role="group" aria-label="OpenRouter BYOK settings">
          <div>
            <div className="lbl">OpenRouter BYOK</div>
          </div>
          <div className="ctrl settings-row__actions">
            <button type="button" className="settings-btn settings-btn--primary settings-btn--compact" onClick={() => handleSectionChange("local")}>Selected</button>
            <input className="settings-input" type="password" autoComplete="off" aria-label="OpenRouter API key" value={localAiSetup.openRouterApiKey} onChange={(event) => onLocalAiSetupChange((current) => ({ ...current, openRouterApiKey: event.target.value }))} placeholder="sk-or-v1-..." />
            <div className="model-picker-summary">
              <div className="model-picker-summary__chips">
                <span className="chip green">Primary: {openRouterPrimaryModel}</span>
                {openRouterFallbackModels.length > 0 ? <span className="chip gray">{openRouterFallbackModels.length} fallback{openRouterFallbackModels.length === 1 ? "" : "s"}</span> : null}
              </div>
              <button type="button" className="settings-btn" aria-label="Choose OpenRouter models" onClick={() => setOpenRouterModelPickerOpen(true)}>Choose models</button>
            </div>
          </div>
        </div>
      </div>
    ),
    ollama: (
      <div className="ai-setup-section-panel__body">
        <div className="cloud-overview__header">
          <div>
            <h3>Local (Ollama)</h3>
          </div>
          <span className="chip">Saved on this Mac</span>
        </div>
        <div className="settings-row settings-row--fallback settings-row--provider-card" role="group" aria-label="Self-hosted AI settings">
          <div>
            <div className="lbl">Self-hosted local AI</div>
          </div>
          <div className="ctrl settings-row__actions">
            <button type="button" className="settings-btn settings-btn--primary settings-btn--compact" onClick={() => handleSectionChange("ollama")}>Selected</button>
            <input className="settings-input" aria-label="Self-hosted base URL" value={localAiSetup.selfHostedBaseUrl} onChange={(event) => onLocalAiSetupChange((current) => ({ ...current, selfHostedBaseUrl: event.target.value }))} placeholder="http://localhost:11434/v1" />
            <div className="model-picker-summary">
              <div className="model-picker-summary__chips"><span className={selfHostedSelectedModel ? "chip green" : "chip gray"}>{selfHostedModelSummary}</span></div>
              <button type="button" className="settings-btn" aria-label="Choose self-hosted model" onClick={() => setSelfHostedModelPickerOpen(true)}>Choose model</button>
            </div>
          </div>
        </div>
      </div>
    ),
  } satisfies Record<AiSetupSection, ReactNode>;

  return (
    <div className="settings-block ai-setup-panel">
      <div className="cloud-overview__header ai-setup-panel__header">
        <div>
          <h3>AI setup</h3>
        </div>
        <span className="chip green">Local-first</span>
      </div>

      <div className="ai-setup-section-tabs" role="tablist" aria-label="AI setup sections">
        {AI_SETUP_SECTIONS.map((section) => {
          const selected = section.id === activeSection;
          return (
            <button
              key={section.id}
              id={`ai-setup-tab-${section.id}`}
              type="button"
              className={`ai-setup-section-tab${selected ? " is-active" : ""}`}
              role="tab"
              aria-selected={selected}
              aria-controls={`ai-setup-panel-${section.id}`}
              onClick={() => handleSectionChange(section.id)}
            >
              <span>{section.label}</span>
            </button>
          );
        })}
      </div>

      <div
        id={`ai-setup-panel-${activeSection}`}
        className="ai-setup-section-panel"
        role="tabpanel"
        aria-labelledby={`ai-setup-tab-${activeSection}`}
      >
        {sectionPanels[activeSection]}
      </div>

      {openRouterModelPickerOpen ? (
        <div className="auth-modal__overlay" onClick={() => setOpenRouterModelPickerOpen(false)}>
          <section className="auth-modal model-picker-modal" role="dialog" aria-modal="true" aria-labelledby="openrouter-model-picker-title" onClick={(event) => event.stopPropagation()}>
            <div className="auth-modal__header">
              <h2 id="openrouter-model-picker-title">OpenRouter models</h2>
              <p>Drifty sends models in priority order. Your API key stays session-only.</p>
            </div>
            <div className="model-picker-modal__summary" aria-label="Selected OpenRouter model summary">
              <span className="chip green">Primary: {openRouterPrimaryModel}</span>
              <span className="chip gray">{openRouterSelectionSummary}</span>
            </div>
            <div className="model-picker-list" role="group" aria-label="OpenRouter model choices">
              {openRouterModelOptions.map((option) => {
                const isSelected = openRouterSelectedModels.includes(option.id);
                const isPrimary = option.id === openRouterPrimaryModel;
                const badge = "badge" in option ? option.badge : null;
                return (
                  <div key={option.id} className="model-picker-choice" data-selected={isSelected ? "true" : "false"}>
                    <label className="model-picker-choice__select">
                      <input type="checkbox" aria-label={`Select ${option.id}`} checked={isSelected} onChange={(event) => handleOpenRouterModelToggle(option.id, event.target.checked)} />
                      <span><strong>{option.label}</strong><small>{option.id}</small><small>{option.detail}</small></span>
                    </label>
                    {badge ? <span className="chip green">{badge}</span> : null}
                    <label className="model-picker-choice__primary">
                      <input type="radio" name="openrouter-primary-model" aria-label={`Use ${option.id} as primary`} checked={isPrimary} disabled={!isSelected} onChange={() => handleOpenRouterPrimaryModelChange(option.id)} />
                      <span>Primary</span>
                    </label>
                  </div>
                );
              })}
            </div>
            <form className="model-picker-custom" onSubmit={handleAddOpenRouterCustomModel}>
              <label htmlFor="openrouter-custom-model">Other model</label>
              <div>
                <input id="openrouter-custom-model" className="settings-input" aria-label="Other OpenRouter model" value={openRouterCustomModel} onChange={(event) => setOpenRouterCustomModel(event.target.value)} placeholder="provider/model-name" />
                <button type="submit" className="settings-btn">Add model</button>
              </div>
            </form>
            <button type="button" className="settings-btn auth-modal__close" onClick={() => setOpenRouterModelPickerOpen(false)}>Close</button>
          </section>
        </div>
      ) : null}

      {selfHostedModelPickerOpen ? (
        <div className="auth-modal__overlay" onClick={() => setSelfHostedModelPickerOpen(false)}>
          <section className="auth-modal model-picker-modal" role="dialog" aria-modal="true" aria-labelledby="self-hosted-model-picker-title" onClick={(event) => event.stopPropagation()}>
            <div className="auth-modal__header">
              <h2 id="self-hosted-model-picker-title">Self-hosted model</h2>
              <p>Pick a common local model or enter the exact model ID returned by your endpoint.</p>
            </div>
            <div className="model-picker-modal__summary" aria-label="Selected self-hosted model summary">
              <span className={selfHostedSelectedModel ? "chip green" : "chip gray"}>{selfHostedModelSummary}</span>
            </div>
            <div className="model-picker-list" role="radiogroup" aria-label="Self-hosted model choices">
              {selfHostedModelOptions.map((option) => {
                const isSelected = option.id === selfHostedSelectedModel;
                return (
                  <div key={option.id} className="model-picker-choice model-picker-choice--single" data-selected={isSelected ? "true" : "false"}>
                    <label className="model-picker-choice__select">
                      <input type="radio" name="self-hosted-model" aria-label={`Use ${option.id}`} checked={isSelected} onChange={() => handleSelfHostedModelChange(option.id)} />
                      <span><strong>{option.label}</strong><small>{option.id}</small><small>{option.detail}</small></span>
                    </label>
                  </div>
                );
              })}
            </div>
            <form className="model-picker-custom" onSubmit={handleAddSelfHostedCustomModel}>
              <label htmlFor="self-hosted-custom-model">Other model</label>
              <div>
                <input id="self-hosted-custom-model" className="settings-input" aria-label="Other self-hosted model" value={selfHostedCustomModel} onChange={(event) => setSelfHostedCustomModel(event.target.value)} placeholder="model-name" />
                <button type="submit" className="settings-btn">Use model</button>
              </div>
            </form>
            <button type="button" className="settings-btn auth-modal__close" onClick={() => setSelfHostedModelPickerOpen(false)}>Close</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
