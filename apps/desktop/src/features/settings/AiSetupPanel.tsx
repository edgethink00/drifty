import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { AiConnectionStatus } from "../ai-connection/AiConnectionStatusBar";
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
import { CustomEndpointSetupPanel } from "./CustomEndpointSetupPanel";
import { DriftySetupPanel, type DriftyRoute } from "./DriftySetupPanel";
import { OpenRouterSetupPanel } from "./OpenRouterSetupPanel";
import type { LocalAiSetupState } from "./localAiSetup";
import { isActiveProviderTestable, providerForSection, sectionForProvider } from "./aiSetupProviderSelection";
import { AiSetupSupportSections } from "./AiSetupSupportSections";
import { AiSetupPanelTabs, type AiSetupPanelTab } from "./AiSetupPanelTabs";
import { useManagedLocalAiSetup } from "./useManagedLocalAiSetup";
import { useAiSetupModelPickers } from "./useAiSetupModelPickers";
import { useWorkProfileSettings } from "./useWorkProfileSettings";
import type { UseAiConnectionTestRunnerResult } from "./useAiConnectionTestRunner";

type CloudSetupHandler = (billingInterval?: BillingInterval) => void | Promise<void>;

export type AiSetupPanelProps = {
  readonly aiServerStatusLabel: string;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPlansDisabled: boolean;
  readonly billingPortalLoading: boolean;
  readonly cloudStatusRefreshing: boolean;
  readonly cloudStatusLabel: string;
  readonly cloudTrialEndsAt: string | null;
  readonly connectionStatus: AiConnectionStatus;
  readonly currentBillingPlan: BillingPlanId | null;
  readonly isSupabaseConfigured: boolean;
  readonly localAiSetup: LocalAiSetupState;
  readonly connectionTest: UseAiConnectionTestRunnerResult;
  readonly shouldShowCloudCheckoutPlans: boolean;
  readonly userEmail: string | null;
  readonly workProfileUserId: string;
  readonly onDialogOpenChange: (open: boolean) => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onStartCloudSetup: CloudSetupHandler;
};

export function AiSetupPanel({
  aiServerStatusLabel,
  billingCheckoutLoadingInterval,
  billingEntitlementError,
  billingEntitlementStatus,
  billingPlansDisabled,
  billingPortalLoading,
  cloudStatusRefreshing,
  cloudStatusLabel,
  cloudTrialEndsAt,
  connectionStatus,
  currentBillingPlan,
  isSupabaseConfigured,
  localAiSetup,
  connectionTest,
  shouldShowCloudCheckoutPlans,
  userEmail,
  workProfileUserId,
  onDialogOpenChange,
  onLocalAiSetupChange,
  onManageCloudBilling,
  onRefreshCloudStatus,
  onStartCloudSetup,
}: AiSetupPanelProps) {
  const selectedSection = sectionForProvider(localAiSetup.provider);
  // Which provider panel is expanded. Defaults to the active provider — Drifty on
  // a fresh install, or OpenRouter once the user has switched their primary to it.
  const [expandedSection, setExpandedSection] = useState<AiSetupSection | null>(() => sectionForProvider(localAiSetup.provider));
  const [activePanelTab, setActivePanelTab] = useState<AiSetupPanelTab>("providers");
  const driftyRoute = localAiSetup.driftyRoute;
  const modelPickers = useAiSetupModelPickers(localAiSetup, onLocalAiSetupChange);
  const managedLocalAi = useManagedLocalAiSetup(expandedSection === "drifty", onLocalAiSetupChange);
  const workProfileSettings = useWorkProfileSettings(workProfileUserId);
  const canUseCloudModel = currentBillingPlan === "individual"
    && !shouldShowCloudCheckoutPlans
    && (billingEntitlementStatus === "active" || billingEntitlementStatus === "trialing");
  const cloudSubscribeActionLabel = canUseCloudModel
    ? null
    : billingCheckoutLoadingInterval === null
      ? "Upgrade"
      : "Opening...";
  const cloudSubscribeActionDisabled = billingPlansDisabled || cloudStatusRefreshing || billingCheckoutLoadingInterval !== null;
  const connectionTestKind = connectionTest.result?.kind ?? null;
  const isCloudRouteSelected = localAiSetup.provider === "managed_local" && driftyRoute === "cloud";
  const preserveCloudProbeErrorRef = useRef(false);

  useEffect(() => {
    onDialogOpenChange(modelPickers.openRouterModelPickerOpen);
    return () => onDialogOpenChange(false);
  }, [modelPickers.openRouterModelPickerOpen, onDialogOpenChange]);

  useEffect(() => {
    if (isCloudRouteSelected && connectionTestKind === "error") return;
    preserveCloudProbeErrorRef.current = false;
  }, [connectionTestKind, isCloudRouteSelected]);

  useEffect(() => {
    if (!isCloudRouteSelected || connectionStatus.tone !== "ok" || connectionTestKind !== "error") return;
    if (preserveCloudProbeErrorRef.current) return;
    connectionTest.clearResult();
  }, [connectionStatus.tone, connectionTest.clearResult, connectionTestKind, isCloudRouteSelected]);

  const clearConnectionTestResult = () => {
    preserveCloudProbeErrorRef.current = false;
    connectionTest.clearResult();
  };

  const selectProvider = (section: AiSetupSection) => {
    onLocalAiSetupChange((current) => ({ ...current, provider: providerForSection(section) }));
  };

  const handleDriftyRouteChange = (route: DriftyRoute) => {
    setExpandedSection("drifty");
    clearConnectionTestResult();
    onLocalAiSetupChange((current) => ({ ...current, provider: "managed_local", driftyRoute: route }));
  };

  const handleProviderChange = (section: AiSetupSection) => {
    clearConnectionTestResult();
    setExpandedSection(section);
    selectProvider(section);
  };

  const handleToggleSection = (section: AiSetupSection) => {
    clearConnectionTestResult();
    const willExpand = expandedSection !== section;
    setExpandedSection(willExpand ? section : null);
  };

  const handleTestConnection = async () => {
    preserveCloudProbeErrorRef.current = isCloudRouteSelected && connectionStatus.tone === "ok";
    await connectionTest.run();
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
            connectionStatus={connectionStatus}
            connectionTestKind={connectionTestKind}
            connectionTestMessage={connectionTest.result?.message ?? null}
            connectionTestRunning={connectionTest.running}
            connectionTestDisabled={connectionTest.running || !isActiveProviderTestable(localAiSetup)}
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
                billingPortalLoading={billingPortalLoading}
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
                onManageCloudBilling={onManageCloudBilling}
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
            <AiSetupSectionCard section={AI_SETUP_SECTIONS[2]} expanded={expandedSection === "custom"} onToggle={handleToggleSection}>
              <CustomEndpointSetupPanel
                localAiSetup={localAiSetup}
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
