import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";
import { OpenRouterModelDialog, SelfHostedModelDialog } from "./AiSetupModelDialogs";
import "./AiSetupPanel.css";
import {
  AI_SETUP_SECTIONS,
  AiSetupSectionCard,
  type AiSetupSection,
} from "./AiSetupSectionCards";
import {
  CloudSetupPanel,
  OllamaSetupPanel,
  OpenRouterSetupPanel,
} from "./AiSetupProviderPanels";
import type { LocalAiSetupState } from "./localAiSetup";
import { testLocalAiConnection, type AiConnectionTestResult } from "./aiConnectionTest";
import { AiSetupSupportSections } from "./AiSetupSupportSections";
import { useAiSetupModelPickers } from "./useAiSetupModelPickers";
import { useWorkProfileSettings } from "./useWorkProfileSettings";

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
  readonly userEmail: string | null;
  readonly workProfileUserId: string;
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
  userEmail,
  workProfileUserId,
  onDialogOpenChange,
  onLocalAiSetupChange,
  onRefreshCloudStatus,
  onStartCloudSetup,
}: AiSetupPanelProps) {
  const [activeSection, setActiveSection] = useState<AiSetupSection>("cloud");
  const [connectionTestResult, setConnectionTestResult] = useState<AiConnectionTestResult | null>(null);
  const [connectionTestRunning, setConnectionTestRunning] = useState(false);
  const modelPickers = useAiSetupModelPickers(localAiSetup, onLocalAiSetupChange);
  const workProfileSettings = useWorkProfileSettings(workProfileUserId);

  useEffect(() => {
    onDialogOpenChange(modelPickers.openRouterModelPickerOpen || modelPickers.selfHostedModelPickerOpen);
    return () => onDialogOpenChange(false);
  }, [modelPickers.openRouterModelPickerOpen, modelPickers.selfHostedModelPickerOpen, onDialogOpenChange]);

  const handleSectionChange = (section: AiSetupSection) => {
    setActiveSection(section);
    setConnectionTestResult(null);
    const provider = providerForSection(section);
    if (provider) onLocalAiSetupChange((current) => ({ ...current, provider }));
  };

  const handleTestConnection = async () => {
    if (connectionTestRunning) return;
    setConnectionTestRunning(true);
    setConnectionTestResult(null);
    const result = await testLocalAiConnection(localAiSetup);
    setConnectionTestResult(result);
    setConnectionTestRunning(false);
  };

  return (
    <div className="settings-block ai-setup-panel">
      <div className="ai-setup-panel__header">
        <h3>AI setup</h3>
      </div>

      <div className="ai-setup-choices" role="group" aria-label="AI setup choices">
        <AiSetupSectionCard section={AI_SETUP_SECTIONS[0]} expanded={activeSection === "cloud"} onToggle={handleSectionChange}>
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
            userEmail={userEmail}
            onRefreshCloudStatus={onRefreshCloudStatus}
            onStartCloudSetup={onStartCloudSetup}
          />
        </AiSetupSectionCard>
        <AiSetupSectionCard section={AI_SETUP_SECTIONS[1]} expanded={activeSection === "local"} onToggle={handleSectionChange}>
          <OpenRouterSetupPanel
            connectionTestMessage={connectionTestResult?.message ?? null}
            connectionTestRunning={connectionTestRunning}
            fallbackCount={modelPickers.openRouterFallbackModels.length}
            localAiSetup={localAiSetup}
            primaryModel={modelPickers.openRouterPrimaryModel}
            onChooseModels={() => modelPickers.setOpenRouterModelPickerOpen(true)}
            onLocalAiSetupChange={onLocalAiSetupChange}
            onTestConnection={handleTestConnection}
          />
        </AiSetupSectionCard>
        <AiSetupSectionCard section={AI_SETUP_SECTIONS[2]} expanded={activeSection === "ollama"} onToggle={handleSectionChange}>
          <OllamaSetupPanel
            connectionTestMessage={connectionTestResult?.message ?? null}
            connectionTestRunning={connectionTestRunning}
            localAiSetup={localAiSetup}
            modelSummary={modelPickers.selfHostedModelSummary}
            onChooseModel={() => modelPickers.setSelfHostedModelPickerOpen(true)}
            onLocalAiSetupChange={onLocalAiSetupChange}
            onTestConnection={handleTestConnection}
          />
        </AiSetupSectionCard>
      </div>

      <div className="ai-setup-support-zone" aria-label="AI prompt settings">
        <div className="ai-setup-support-zone__header">
          <div>
            <span className="eyebrow">AI prompt settings</span>
            <strong>Work context and privacy</strong>
          </div>
          <p>Shared by Drifty Cloud, OpenRouter, and local AI classification.</p>
        </div>
        <AiSetupSupportSections
          workProfileDraft={workProfileSettings.workProfileDraft}
          workProfileMessage={workProfileSettings.workProfileMessage}
          onSaveWorkProfile={workProfileSettings.handleSaveWorkProfile}
          onWorkProfileDraftChange={workProfileSettings.handleWorkProfileDraftChange}
        />
      </div>

      {modelPickers.openRouterModelPickerOpen ? (
        <OpenRouterModelDialog
          customModel={modelPickers.openRouterCustomModel}
          fallbackSummary={modelPickers.openRouterSelectionSummary}
          openRouterPrimaryModel={modelPickers.openRouterPrimaryModel}
          options={modelPickers.openRouterModelOptions}
          selectedModels={modelPickers.openRouterSelectedModels}
          onAddCustomModel={modelPickers.handleAddOpenRouterCustomModel}
          onClose={() => modelPickers.setOpenRouterModelPickerOpen(false)}
          onCustomModelChange={modelPickers.setOpenRouterCustomModel}
          onPrimaryModelChange={modelPickers.handleOpenRouterPrimaryModelChange}
          onToggleModel={modelPickers.handleOpenRouterModelToggle}
        />
      ) : null}

      {modelPickers.selfHostedModelPickerOpen ? (
        <SelfHostedModelDialog
          customModel={modelPickers.selfHostedCustomModel}
          modelSummary={modelPickers.selfHostedModelSummary}
          options={modelPickers.selfHostedModelOptions}
          selectedModel={modelPickers.selfHostedSelectedModel}
          onAddCustomModel={modelPickers.handleAddSelfHostedCustomModel}
          onClose={() => modelPickers.setSelfHostedModelPickerOpen(false)}
          onCustomModelChange={modelPickers.setSelfHostedCustomModel}
          onModelChange={modelPickers.handleSelfHostedModelChange}
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
