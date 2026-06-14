import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";

import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";
import { OpenRouterModelDialog, SelfHostedModelDialog, type AiModelOption } from "./AiSetupModelDialogs";
import "./AiSetupPanel.css";
import {
  AI_SETUP_SECTIONS,
  AiSetupSectionCard,
  CloudSetupPanel,
  OllamaSetupPanel,
  OpenRouterSetupPanel,
  type AiSetupSection,
} from "./AiSetupSectionCards";
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

type CloudSetupHandler = (billingInterval?: BillingInterval) => void | Promise<void>;

type AiSetupPanelProps = {
  readonly aiServerStatusLabel: string;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPlansDisabled: boolean;
  readonly cloudStatusRefreshing: boolean;
  readonly cloudStatusLabel: string;
  readonly cloudTrialEndsAt: string | null;
  readonly currentBillingPlan: BillingPlanId | null;
  readonly isSupabaseConfigured: boolean;
  readonly localAiSetup: LocalAiSetupState;
  readonly shouldShowCloudCheckoutPlans: boolean;
  readonly onDialogOpenChange: (open: boolean) => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onStartCloudSetup: CloudSetupHandler;
};

export function AiSetupPanel({
  aiServerStatusLabel,
  billingCheckoutLoadingInterval,
  billingEntitlementError,
  billingEntitlementStatus,
  billingPlansDisabled,
  cloudStatusRefreshing,
  cloudStatusLabel,
  cloudTrialEndsAt,
  currentBillingPlan,
  isSupabaseConfigured,
  localAiSetup,
  shouldShowCloudCheckoutPlans,
  onDialogOpenChange,
  onLocalAiSetupChange,
  onRefreshCloudStatus,
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
  const openRouterModelOptions = useMemo((): readonly AiModelOption[] => [
    ...OPENROUTER_RECOMMENDED_MODELS,
    ...openRouterCustomSelectedModels.map((model) => ({ id: model, label: model, detail: "Other model" })),
  ], [openRouterCustomSelectedModels]);
  const openRouterSelectionSummary = openRouterFallbackModels.length > 0
    ? `${openRouterPrimaryModel} + ${openRouterFallbackModels.length} fallback${openRouterFallbackModels.length === 1 ? "" : "s"}`
    : openRouterPrimaryModel;
  const selfHostedSelectedModel = localAiSetup.selfHostedModel.trim();
  const selfHostedCustomSelectedModels = selfHostedSelectedModel && !isRecommendedSelfHostedModel(selfHostedSelectedModel) ? [selfHostedSelectedModel] : [];
  const selfHostedModelOptions = useMemo((): readonly AiModelOption[] => [
    ...SELF_HOSTED_RECOMMENDED_MODELS,
    ...selfHostedCustomSelectedModels.map((model) => ({ id: model, label: model, detail: "Other model" })),
  ], [selfHostedCustomSelectedModels]);
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
    onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedModel: modelId }));
  };

  const handleAddSelfHostedCustomModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const modelId = selfHostedCustomModel.trim();
    if (!modelId) return;
    onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedModel: modelId }));
    setSelfHostedCustomModel("");
  };

  return (
    <div className="settings-block ai-setup-panel">
      <div className="ai-setup-panel__header">
        <h3>AI setup</h3>
      </div>

      <div className="ai-setup-choices" role="group" aria-label="AI setup choices">
        <AiSetupSectionCard section={AI_SETUP_SECTIONS[0]} expanded={activeSection === "cloud"} badges={[aiServerStatusLabel, isSupabaseConfigured ? "Polar checkout" : "Cloud off"]} onToggle={handleSectionChange}>
          <CloudSetupPanel
            aiServerStatusLabel={aiServerStatusLabel}
            billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
            billingEntitlementError={billingEntitlementError}
            billingEntitlementStatus={billingEntitlementStatus}
            billingPlansDisabled={billingPlansDisabled}
            cloudStatusRefreshing={cloudStatusRefreshing}
            cloudStatusLabel={cloudStatusLabel}
            cloudTrialEndsAt={cloudTrialEndsAt}
            currentBillingPlan={currentBillingPlan}
            isSupabaseConfigured={isSupabaseConfigured}
            shouldShowCloudCheckoutPlans={shouldShowCloudCheckoutPlans}
            onRefreshCloudStatus={onRefreshCloudStatus}
            onStartCloudSetup={onStartCloudSetup}
          />
        </AiSetupSectionCard>
        <AiSetupSectionCard section={AI_SETUP_SECTIONS[1]} expanded={activeSection === "local"} badges={[localAiSetup.provider === "openrouter_byok" ? "Selected" : "BYOK", localAiSetup.openRouterApiKey.trim() ? "Key ready" : "Key needed", openRouterPrimaryModel]} onToggle={handleSectionChange}>
          <OpenRouterSetupPanel
            fallbackCount={openRouterFallbackModels.length}
            localAiSetup={localAiSetup}
            primaryModel={openRouterPrimaryModel}
            onChooseModels={() => setOpenRouterModelPickerOpen(true)}
            onLocalAiSetupChange={onLocalAiSetupChange}
          />
        </AiSetupSectionCard>
        <AiSetupSectionCard section={AI_SETUP_SECTIONS[2]} expanded={activeSection === "ollama"} badges={[localAiSetup.provider === "self_hosted" ? "Selected" : "Local", selfHostedSelectedModel || "Choose model"]} onToggle={handleSectionChange}>
          <OllamaSetupPanel
            localAiSetup={localAiSetup}
            modelSummary={selfHostedModelSummary}
            onChooseModel={() => setSelfHostedModelPickerOpen(true)}
            onLocalAiSetupChange={onLocalAiSetupChange}
          />
        </AiSetupSectionCard>
      </div>

      {openRouterModelPickerOpen ? (
        <OpenRouterModelDialog
          customModel={openRouterCustomModel}
          fallbackSummary={openRouterSelectionSummary}
          openRouterPrimaryModel={openRouterPrimaryModel}
          options={openRouterModelOptions}
          selectedModels={openRouterSelectedModels}
          onAddCustomModel={handleAddOpenRouterCustomModel}
          onClose={() => setOpenRouterModelPickerOpen(false)}
          onCustomModelChange={setOpenRouterCustomModel}
          onPrimaryModelChange={handleOpenRouterPrimaryModelChange}
          onToggleModel={handleOpenRouterModelToggle}
        />
      ) : null}

      {selfHostedModelPickerOpen ? (
        <SelfHostedModelDialog
          customModel={selfHostedCustomModel}
          modelSummary={selfHostedModelSummary}
          options={selfHostedModelOptions}
          selectedModel={selfHostedSelectedModel}
          onAddCustomModel={handleAddSelfHostedCustomModel}
          onClose={() => setSelfHostedModelPickerOpen(false)}
          onCustomModelChange={setSelfHostedCustomModel}
          onModelChange={handleSelfHostedModelChange}
        />
      ) : null}
    </div>
  );
}

function providerForSection(section: AiSetupSection): LocalAiSetupState["provider"] | null {
  switch (section) {
    case "cloud":
      return null;
    case "local":
      return "openrouter_byok";
    case "ollama":
      return "self_hosted";
    default:
      return assertNever(section);
  }
}

class AiSetupSectionError extends Error {
  constructor(readonly section: string) {
    super(`Unhandled AI setup section: ${section}`);
    this.name = "AiSetupSectionError";
  }
}

function assertNever(value: never): never {
  throw new AiSetupSectionError(String(value));
}
