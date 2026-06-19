import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";
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
import { testLocalAiConnection, type AiConnectionTestResult } from "./aiConnectionTest";
import { testCloudAiConnection } from "./cloudAiConnectionTest";
import { isActiveProviderTestable, providerForSection, sectionForProvider } from "./aiSetupProviderSelection";
import { AiSetupSupportSections } from "./AiSetupSupportSections";
import { AiSetupPanelTabs, type AiSetupPanelTab } from "./AiSetupPanelTabs";
import { useManagedLocalAiSetup } from "./useManagedLocalAiSetup";
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
  readonly onLocalAiConnectionTestResult: (setup: LocalAiSetupState, result: AiConnectionTestResult) => void;
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
  onLocalAiConnectionTestResult,
  onLocalAiSetupChange,
  onRefreshCloudStatus,
  onStartCloudSetup,
}: AiSetupPanelProps) {
  const selectedSection = sectionForProvider(localAiSetup.provider);
  // Which provider panel is expanded. Defaults to the active provider — Drifty on
  // a fresh install, or OpenRouter once the user has switched their primary to it.
  const [expandedSection, setExpandedSection] = useState<AiSetupSection | null>(() => sectionForProvider(localAiSetup.provider));
  const [activePanelTab, setActivePanelTab] = useState<AiSetupPanelTab>("providers");
  const [connectionTestResult, setConnectionTestResult] = useState<AiConnectionTestResult | null>(null);
  const [connectionTestRunning, setConnectionTestRunning] = useState(false);
  const driftyRoute = localAiSetup.driftyRoute;
  const modelPickers = useAiSetupModelPickers(localAiSetup, onLocalAiSetupChange);
  const managedLocalAi = useManagedLocalAiSetup(expandedSection === "drifty", onLocalAiSetupChange);
  const workProfileSettings = useWorkProfileSettings(workProfileUserId);
  const isCurrentCloudPlan = currentBillingPlan === "individual" && !shouldShowCloudCheckoutPlans;
  const cloudSubscribeActionLabel = isCurrentCloudPlan
    ? null
    : billingCheckoutLoadingInterval === null
      ? "Subscribe"
      : "Opening...";
  const cloudSubscribeActionDisabled = billingPlansDisabled || cloudStatusRefreshing || billingCheckoutLoadingInterval !== null;

  useEffect(() => {
    onDialogOpenChange(modelPickers.openRouterModelPickerOpen);
    return () => onDialogOpenChange(false);
  }, [modelPickers.openRouterModelPickerOpen, onDialogOpenChange]);

  const selectProvider = (section: AiSetupSection) => {
    const provider = providerForSection(section);
    if (provider) onLocalAiSetupChange((current) => ({ ...current, provider }));
    if (section === "drifty") onLocalAiSetupChange((current) => ({ ...current, provider: "managed_local" }));
  };

  const handleDriftyRouteChange = (route: DriftyRoute) => {
    setExpandedSection("drifty");
    setConnectionTestResult(null);
    onLocalAiSetupChange((current) => ({ ...current, provider: "managed_local", driftyRoute: route }));
  };

  const handleProviderChange = (section: AiSetupSection) => {
    setConnectionTestResult(null);
    setExpandedSection(section);
    selectProvider(section);
  };

  const handleToggleSection = (section: AiSetupSection) => {
    setConnectionTestResult(null);
    const willExpand = expandedSection !== section;
    setExpandedSection(willExpand ? section : null);
  };

  const handleTestConnection = async () => {
    if (connectionTestRunning) return;
    setConnectionTestRunning(true);
    setConnectionTestResult(null);
    const isCloudRoute = localAiSetup.provider === "managed_local" && localAiSetup.driftyRoute === "cloud";
    const result = isCloudRoute ? await testCloudAiConnection() : await testLocalAiConnection(localAiSetup);
    setConnectionTestResult(result);
    if (!isCloudRoute) onLocalAiConnectionTestResult(localAiSetup, result);
    setConnectionTestRunning(false);
  };

  return (
    <div className="settings-block ai-setup-panel">
      <div className="ai-setup-panel__header">
        <h3>AI setup</h3>
      </div>

      <AiSetupPanelTabs activeTab={activePanelTab} onChange={setActivePanelTab} />

      {activePanelTab === "providers" ? (
        <section id="ai-setup-panel-tab-providers" className="ai-setup-tab-panel" role="tabpanel" aria-label="Providers">
          <AiSetupModelBeingUsed
            actionModelId={managedLocalAi.actionModelId}
            catalog={managedLocalAi.catalog}
            connectionTestKind={connectionTestResult?.kind ?? null}
            connectionTestMessage={connectionTestResult?.message ?? null}
            connectionTestRunning={connectionTestRunning}
            connectionTestDisabled={connectionTestRunning || !isActiveProviderTestable(localAiSetup)}
            driftyRoute={driftyRoute}
            localAiSetup={localAiSetup}
            managedLocalStatus={managedLocalAi.status}
            openRouterModelOptions={modelPickers.openRouterModelOptions}
            openRouterPrimaryModel={modelPickers.openRouterPrimaryModel}
            selectedProvider={selectedSection}
            cloudSubscribeActionDisabled={cloudSubscribeActionDisabled}
            cloudSubscribeActionLabel={cloudSubscribeActionLabel}
            onDriftyRouteChange={handleDriftyRouteChange}
            onInstallModel={managedLocalAi.installModel}
            onLocalAiSetupChange={onLocalAiSetupChange}
            onOpenRouterPrimaryModelChange={modelPickers.handleOpenRouterPrimaryModelChange}
            onProviderChange={handleProviderChange}
            onStartCloudSetup={onStartCloudSetup}
            onTestConnection={handleTestConnection}
          />

          <h4 className="ai-setup-provider-heading">Configure providers</h4>

          <div className="ai-setup-choices" role="group" aria-label="AI setup choices">
            <AiSetupSectionCard section={AI_SETUP_SECTIONS[0]} expanded={expandedSection === "drifty"} onToggle={handleToggleSection}>
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
                onRefreshCloudStatus={onRefreshCloudStatus}
                onStartCloudSetup={onStartCloudSetup}
              />
            </AiSetupSectionCard>
            <AiSetupSectionCard section={AI_SETUP_SECTIONS[1]} expanded={expandedSection === "openrouter"} onToggle={handleToggleSection}>
              <OpenRouterSetupPanel
                localAiSetup={localAiSetup}
                onChooseModels={() => modelPickers.setOpenRouterModelPickerOpen(true)}
                onLocalAiSetupChange={onLocalAiSetupChange}
              />
            </AiSetupSectionCard>
          </div>
        </section>
      ) : (
        <section id="ai-setup-panel-tab-profile" className="ai-setup-tab-panel" role="tabpanel" aria-label="Profile and information">
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
        </section>
      )}

      {modelPickers.openRouterModelPickerOpen ? (
        <OpenRouterModelDialog
          customModel={modelPickers.openRouterCustomModel}
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
