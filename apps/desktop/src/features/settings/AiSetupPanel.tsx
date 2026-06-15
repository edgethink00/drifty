import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";
import { saveUserWorkProfile, summarizeUserWorkProfile } from "../onboarding/onboardingState";
import { OpenRouterModelDialog, SelfHostedModelDialog } from "./AiSetupModelDialogs";
import "./AiSetupPanel.css";
import {
  AI_SETUP_SECTIONS,
  AiSetupSectionCard,
  CloudSetupPanel,
  OllamaSetupPanel,
  OpenRouterSetupPanel,
  type AiSetupSection,
} from "./AiSetupSectionCards";
import type { LocalAiSetupState } from "./localAiSetup";
import { testLocalAiConnection, type AiConnectionTestResult } from "./aiConnectionTest";
import { AiSetupSupportSections } from "./AiSetupSupportSections";
import { useAiSetupModelPickers } from "./useAiSetupModelPickers";

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
  const [workProfileDraft, setWorkProfileDraft] = useState(() => summarizeUserWorkProfile(workProfileUserId));
  const [workProfileMessage, setWorkProfileMessage] = useState<string | null>(null);
  const modelPickers = useAiSetupModelPickers(localAiSetup, onLocalAiSetupChange);
  const workProfilePreview = workProfileDraft.trim() || "No work profile saved yet";

  useEffect(() => {
    onDialogOpenChange(modelPickers.openRouterModelPickerOpen || modelPickers.selfHostedModelPickerOpen);
    return () => onDialogOpenChange(false);
  }, [modelPickers.openRouterModelPickerOpen, modelPickers.selfHostedModelPickerOpen, onDialogOpenChange]);

  useEffect(() => {
    setWorkProfileDraft(summarizeUserWorkProfile(workProfileUserId));
    setWorkProfileMessage(null);
  }, [workProfileUserId]);

  const handleSectionChange = (section: AiSetupSection) => {
    setActiveSection(section);
    setConnectionTestResult(null);
    const provider = providerForSection(section);
    if (provider) onLocalAiSetupChange((current) => ({ ...current, provider }));
  };

  const handleSaveWorkProfile = () => {
    const savedState = saveUserWorkProfile(workProfileUserId, workProfileDraft);
    setWorkProfileMessage(savedState ? "Work profile saved for future AI classification." : "Enter a work profile before saving.");
    if (savedState) setWorkProfileDraft(summarizeUserWorkProfile(workProfileUserId));
  };

  const handleWorkProfileDraftChange = (value: string) => {
    setWorkProfileDraft(value);
    setWorkProfileMessage(null);
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
            userEmail={userEmail}
            onRefreshCloudStatus={onRefreshCloudStatus}
            onStartCloudSetup={onStartCloudSetup}
          />
        </AiSetupSectionCard>
        <AiSetupSectionCard section={AI_SETUP_SECTIONS[1]} expanded={activeSection === "local"} badges={[localAiSetup.provider === "openrouter_byok" ? "Selected" : "BYOK", localAiSetup.openRouterApiKey.trim() ? "Key ready" : "Key needed", modelPickers.openRouterPrimaryModel]} onToggle={handleSectionChange}>
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
        <AiSetupSectionCard section={AI_SETUP_SECTIONS[2]} expanded={activeSection === "ollama"} badges={[localAiSetup.provider === "self_hosted" ? "Selected" : "Local", modelPickers.selfHostedSelectedModel || "Choose model"]} onToggle={handleSectionChange}>
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

      <AiSetupSupportSections
        workProfileDraft={workProfileDraft}
        workProfileMessage={workProfileMessage}
        workProfilePreview={workProfilePreview}
        onSaveWorkProfile={handleSaveWorkProfile}
        onWorkProfileDraftChange={handleWorkProfileDraftChange}
      />

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
