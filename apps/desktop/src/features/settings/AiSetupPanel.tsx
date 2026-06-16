import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";
import { saveUserWorkProfile, summarizeUserWorkProfile } from "../onboarding/onboardingState";
import { OpenRouterModelDialog } from "./AiSetupModelDialogs";
import "./AiSetupPanel.css";
import {
  AI_SETUP_SECTIONS,
  AiSetupSectionCard,
  type AiSetupSection,
} from "./AiSetupSectionCards";
import { AiSetupModelBeingUsed } from "./AiSetupModelBeingUsed";
import { DriftySetupPanel, type DriftyRoute } from "./DriftySetupPanel";
import { OpenRouterSetupPanel } from "./OpenRouterSetupPanel";
import type { LocalAiSetupState } from "./localAiSetup";
import type { ManagedLocalAiModel } from "./managedLocalAiClient";
import { testLocalAiConnection, type AiConnectionTestResult } from "./aiConnectionTest";
import { AiSetupSupportSections } from "./AiSetupSupportSections";
import { useManagedLocalAiSetup } from "./useManagedLocalAiSetup";
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
  const [activeSection, setActiveSection] = useState<AiSetupSection>(() => sectionForProvider(localAiSetup.provider));
  const [connectionTestResult, setConnectionTestResult] = useState<AiConnectionTestResult | null>(null);
  const [connectionTestRunning, setConnectionTestRunning] = useState(false);
  const [driftyRoute, setDriftyRoute] = useState<DriftyRoute>(() => localAiSetup.provider === "managed_local" ? "local" : "cloud");
  const [workProfileDraft, setWorkProfileDraft] = useState(() => summarizeUserWorkProfile(workProfileUserId));
  const [workProfileMessage, setWorkProfileMessage] = useState<string | null>(null);
  const modelPickers = useAiSetupModelPickers(localAiSetup, onLocalAiSetupChange);
  const managedLocalAi = useManagedLocalAiSetup(activeSection === "drifty", onLocalAiSetupChange);
  const workProfilePreview = workProfileDraft.trim() || "No work profile saved yet";

  useEffect(() => {
    onDialogOpenChange(modelPickers.openRouterModelPickerOpen);
    return () => onDialogOpenChange(false);
  }, [modelPickers.openRouterModelPickerOpen, onDialogOpenChange]);

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

      <AiSetupModelBeingUsed
        catalog={managedLocalAi.catalog}
        driftyRoute={driftyRoute}
        localAiSetup={localAiSetup}
        openRouterModelOptions={modelPickers.openRouterModelOptions}
        openRouterPrimaryModel={modelPickers.openRouterPrimaryModel}
        selectedProvider={activeSection}
        onDriftyRouteChange={setDriftyRoute}
        onLocalAiSetupChange={onLocalAiSetupChange}
        onOpenRouterPrimaryModelChange={modelPickers.handleOpenRouterPrimaryModelChange}
        onProviderChange={handleSectionChange}
      />

      <h4 className="ai-setup-provider-heading">Configure providers</h4>

      <div className="ai-setup-choices" role="group" aria-label="AI setup choices">
        <AiSetupSectionCard section={AI_SETUP_SECTIONS[0]} expanded={activeSection === "drifty"} badges={driftySectionBadges(localAiSetup, managedLocalAi.status?.state ?? null, managedLocalAi.catalog, aiServerStatusLabel, driftyRoute)} onToggle={handleSectionChange}>
          <DriftySetupPanel
            actionModelId={managedLocalAi.actionModelId}
            aiServerStatusLabel={aiServerStatusLabel}
            billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
            billingEntitlementError={billingEntitlementError}
            billingEntitlementStatus={billingEntitlementStatus}
            billingPlansDisabled={billingPlansDisabled}
            catalog={managedLocalAi.catalog}
            cloudStatusRefreshing={cloudStatusRefreshing}
            cloudStatusLabel={cloudStatusLabel}
            cloudTrialEndsAt={cloudTrialEndsAt}
            connectionTestMessage={connectionTestResult?.message ?? null}
            connectionTestRunning={connectionTestRunning}
            currentBillingPlan={currentBillingPlan}
            isSupabaseConfigured={isSupabaseConfigured}
            loading={managedLocalAi.loading}
            localAiSetup={localAiSetup}
            selectedRoute={driftyRoute}
            shouldShowCloudCheckoutPlans={shouldShowCloudCheckoutPlans}
            status={managedLocalAi.status}
            userEmail={userEmail}
            onDeleteModel={managedLocalAi.deleteModel}
            onInstallModel={managedLocalAi.installModel}
            onLocalAiSetupChange={onLocalAiSetupChange}
            onRefreshCloudStatus={onRefreshCloudStatus}
            onStartCloudSetup={onStartCloudSetup}
            onStartModel={managedLocalAi.startModel}
            onTestConnection={handleTestConnection}
          />
        </AiSetupSectionCard>
        <AiSetupSectionCard section={AI_SETUP_SECTIONS[1]} expanded={activeSection === "openrouter"} badges={[localAiSetup.provider === "openrouter_byok" ? "Selected" : "BYOK", localAiSetup.openRouterApiKey.trim() ? "Key ready" : "Key needed", modelPickers.openRouterPrimaryModel]} onToggle={handleSectionChange}>
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
    </div>
  );
}

function providerForSection(section: AiSetupSection): LocalAiSetupState["provider"] | null {
  switch (section) {
    case "drifty":
      return null;
    case "openrouter":
      return "openrouter_byok";
    default:
      return assertNever(section);
  }
}

function sectionForProvider(provider: LocalAiSetupState["provider"]): AiSetupSection {
  switch (provider) {
    case "managed_local":
    case "self_hosted":
      return "drifty";
    case "openrouter_byok":
      return "openrouter";
    default:
      return assertNever(provider);
  }
}

function driftySectionBadges(
  localAiSetup: LocalAiSetupState,
  managedState: "not_installed" | "installing" | "installed" | "running" | "error" | null,
  catalog: readonly ManagedLocalAiModel[],
  cloudStatus: string,
  driftyRoute: DriftyRoute,
): readonly string[] {
  const modeBadge = driftyRoute === "local" ? "Local selected" : "Cloud";
  const managedBadge = managedState === "running" ? "Running" : managedState === "installed" ? "Downloaded" : "Download";
  return [cloudStatus, modeBadge, managedBadge, selectedManagedModelLabel(catalog, localAiSetup.managedLocalModelId)];
}

function selectedManagedModelLabel(catalog: readonly ManagedLocalAiModel[], modelId: string): string {
  return catalog.find((model) => model.id === modelId)?.label ?? "Local model";
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
