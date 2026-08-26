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
import { OpenRouterSetupPanel } from "./OpenRouterSetupPanel";
import type { DriftyAiRoute, LocalAiSetupState } from "./localAiSetup";
import { isActiveProviderTestable, providerForSection, sectionForProvider } from "./aiSetupProviderSelection";
import { AiSetupSupportSections } from "./AiSetupSupportSections";
import { AiSetupPanelTabs, type AiSetupPanelTab } from "./AiSetupPanelTabs";
import { IntelligenceSetupPanel } from "./IntelligenceSetupPanel";
import type { AnalysisAiSetupState } from "./analysisModelSetup";
import { useManagedLocalAiSetup } from "./useManagedLocalAiSetup";
import { useAiSetupModelPickers } from "./useAiSetupModelPickers";
import { useWorkProfileSettings } from "./useWorkProfileSettings";
import type { UseAiConnectionTestRunnerResult } from "./useAiConnectionTestRunner";
import { useLocalization } from "../localization/LocalizationContext";

type CloudSetupHandler = (billingInterval?: BillingInterval) => void | Promise<void>;

export type AiSetupPanelProps = {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPlansDisabled: boolean;
  readonly cloudStatusRefreshing: boolean;
  readonly connectionStatus: AiConnectionStatus;
  readonly currentBillingPlan: BillingPlanId | null;
  readonly localAiSetup: LocalAiSetupState;
  readonly connectionTest: UseAiConnectionTestRunnerResult;
  readonly shouldShowCloudCheckoutPlans: boolean;
  readonly workProfileUserId: string;
  readonly analysisSetup: AnalysisAiSetupState;
  readonly analysisOpenRouterConnected: boolean;
  /** Show the Intelligence tab (project-classification preview). Dev-gated. */
  readonly showIntelligenceTab: boolean;
  /** One-shot: open this tab on arrival (e.g. Projects → AI setup lands on Intelligence). */
  readonly requestedTab?: AiSetupPanelTab | null;
  readonly onRequestedTabConsumed?: () => void;
  readonly onAnalysisChange: (next: AnalysisAiSetupState) => void;
  readonly onDialogOpenChange: (open: boolean) => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onStartCloudSetup: CloudSetupHandler;
};

export function AiSetupPanel({
  billingCheckoutLoadingInterval,
  billingEntitlementStatus,
  billingPlansDisabled,
  cloudStatusRefreshing,
  connectionStatus,
  currentBillingPlan,
  localAiSetup,
  connectionTest,
  shouldShowCloudCheckoutPlans,
  workProfileUserId,
  analysisSetup,
  analysisOpenRouterConnected,
  showIntelligenceTab,
  requestedTab = null,
  onRequestedTabConsumed,
  onAnalysisChange,
  onDialogOpenChange,
  onLocalAiSetupChange,
  onManageCloudBilling,
  onStartCloudSetup,
}: AiSetupPanelProps) {
  const { t } = useLocalization();
  const selectedSection = sectionForProvider(localAiSetup.provider);
  // Which provider panel is expanded. Defaults to the active provider — Drifty on
  // a fresh install, or OpenRouter once the user has switched their primary to it.
  const [expandedSection, setExpandedSection] = useState<AiSetupSection | null>(() => sectionForProvider(localAiSetup.provider));
  const [activePanelTab, setActivePanelTab] = useState<AiSetupPanelTab>("providers");
  const driftyRoute = localAiSetup.driftyRoute;
  const modelPickers = useAiSetupModelPickers(localAiSetup, onLocalAiSetupChange);
  // The Drifty provider has no card any more — its cloud/local models are managed
  // entirely from the Model-being-used dropdown, so load the managed-local catalog
  // whenever Drifty is the active provider (rather than when a card is expanded).
  const managedLocalAi = useManagedLocalAiSetup(selectedSection === "drifty", onLocalAiSetupChange);
  const workProfileSettings = useWorkProfileSettings(workProfileUserId);
  const canUseCloudModel = currentBillingPlan === "individual"
    && !shouldShowCloudCheckoutPlans
    && (billingEntitlementStatus === "active" || billingEntitlementStatus === "trialing");
  const cloudIsTrialing = billingEntitlementStatus === "trialing";
  // A "locked" entitlement means the user HAS a subscription that's currently blocked
  // (device limit reached, payment required, …). Those states must route to Manage
  // billing (Stripe portal) to recover — never to a fresh checkout, which would sell
  // them a second subscription.
  const cloudLocked = billingEntitlementStatus === "locked" && currentBillingPlan === "individual";
  // Manage-billing states = fully active (secondary, hover action) OR locked (primary
  // recovery action). Upgrade/checkout states = trialing (convert the trial) OR a
  // genuine no-subscription. `canManageBilling` covers active + locked; the Upgrade
  // label is shown only for the trialing / no-sub states.
  const cloudCanManageBilling = (canUseCloudModel && !cloudIsTrialing) || cloudLocked;
  const cloudShowsUpgrade = cloudIsTrialing || (!canUseCloudModel && !cloudLocked);
  const cloudSubscribeActionLabel = cloudShowsUpgrade
    ? (billingCheckoutLoadingInterval === null ? t("settings.ai.upgrade") : t("settings.ai.opening"))
    : null;
  const cloudSubscribeActionDisabled = billingPlansDisabled || cloudStatusRefreshing || billingCheckoutLoadingInterval !== null;
  const connectionTestKind = connectionTest.result?.kind ?? null;
  const isCloudRouteSelected = localAiSetup.provider === "managed_local" && driftyRoute === "cloud";
  const preserveCloudProbeErrorRef = useRef(false);

  useEffect(() => {
    onDialogOpenChange(modelPickers.openRouterModelPickerOpen);
    return () => onDialogOpenChange(false);
  }, [modelPickers.openRouterModelPickerOpen, onDialogOpenChange]);

  // Externally requested tab (one-shot), e.g. the Projects page's "AI setup".
  useEffect(() => {
    if (!requestedTab) return;
    if (requestedTab !== "intelligence" || showIntelligenceTab) setActivePanelTab(requestedTab);
    onRequestedTabConsumed?.();
  }, [requestedTab, showIntelligenceTab, onRequestedTabConsumed]);

  // If the Intelligence preview is switched off while its tab is open, fall back
  // to Classification so the panel never shows an orphaned tab.
  useEffect(() => {
    if (!showIntelligenceTab && activePanelTab === "intelligence") setActivePanelTab("providers");
  }, [showIntelligenceTab, activePanelTab]);

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

  const handleDriftyRouteChange = (route: DriftyAiRoute) => {
    setExpandedSection("drifty");
    clearConnectionTestResult();
    onLocalAiSetupChange((current) => ({ ...current, provider: "managed_local", driftyRoute: route }));
  };

  // A provider is ready to become active once its credentials/config are set. Drifty
  // is always reachable (cloud upgrade / local download live in the model dropdown).
  const sectionReady = (section: AiSetupSection): boolean => {
    switch (section) {
      case "openrouter":
        return localAiSetup.openRouterApiKey.trim().length > 0;
      case "custom":
        return localAiSetup.selfHostedBaseUrl.trim().length > 0 && localAiSetup.selfHostedModel.trim().length > 0;
      default:
        return true;
    }
  };

  const handleProviderChange = (section: AiSetupSection) => {
    clearConnectionTestResult();
    // Always reveal the provider's Configure card; only commit to it once it's ready.
    // Picking an unconfigured provider just expands its card so it can be set up first.
    setExpandedSection(section);
    if (sectionReady(section)) selectProvider(section);
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
        <h3>{t("settings.section.aiSetup")}</h3>
      </div>

      <AiSetupPanelTabs activeTab={activePanelTab} onChange={setActivePanelTab} showIntelligenceTab={showIntelligenceTab} />

      {activePanelTab === "providers" ? (
        <section id="ai-setup-panel-tab-providers" className="ai-setup-tab-panel" role="tabpanel" aria-label={t("settings.ai.providers")}>
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
            cloudSelectable={canUseCloudModel}
            canManageBilling={cloudCanManageBilling}
            onDriftyRouteChange={handleDriftyRouteChange}
            onInstallModel={managedLocalAi.installModel}
            onDeleteModel={managedLocalAi.deleteModel}
            onLocalAiSetupChange={onLocalAiSetupChange}
            onManageCloudBilling={onManageCloudBilling}
            onOpenRouterPrimaryModelChange={modelPickers.handleOpenRouterPrimaryModelChange}
            onProviderChange={handleProviderChange}
            onStartCloudSetup={onStartCloudSetup}
            onTestConnection={handleTestConnection}
          />

          <h4 className="ai-setup-provider-heading">{t("settings.ai.configureProviders")}</h4>

          <div className="ai-setup-choices" role="group" aria-label={t("settings.ai.setupChoicesAria")}>
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
      ) : activePanelTab === "intelligence" && showIntelligenceTab ? (
        <section id="ai-setup-panel-tab-intelligence" className="ai-setup-tab-panel" role="tabpanel" aria-label={t("settings.ai.intelligence")}>
          <IntelligenceSetupPanel
            setup={analysisSetup}
            onChange={onAnalysisChange}
            onConnectOpenRouter={() => {
              setActivePanelTab("providers");
              setExpandedSection("openrouter");
            }}
            openRouterConnected={analysisOpenRouterConnected}
            cloudSelectable={canUseCloudModel}
            cloudSubscribeActionLabel={cloudSubscribeActionLabel}
            cloudSubscribeActionDisabled={cloudSubscribeActionDisabled}
            canManageBilling={cloudCanManageBilling}
            onStartCloudSetup={onStartCloudSetup}
            onManageCloudBilling={onManageCloudBilling}
          />
        </section>
      ) : (
        <section id="ai-setup-panel-tab-profile" className="ai-setup-tab-panel" role="tabpanel" aria-label={t("settings.ai.profile")}>
          <div className="ai-setup-support-zone" aria-label={t("settings.ai.promptSettings")}>
            <div className="ai-setup-support-zone__header">
              <div>
                <span className="eyebrow">{t("settings.ai.promptSettings")}</span>
                <strong>{t("settings.ai.workContextPrivacy")}</strong>
              </div>
              <p>{t("settings.ai.promptSettingsDescription")}</p>
            </div>
            <dl className="ai-setup-memory-summary" aria-label={t("settings.ai.memorySummaryAria")}>
              <div>
                <dt>{t("settings.ai.memoryWorkContextLabel")}</dt>
                <dd>{t("settings.ai.memoryWorkContextDescription")}</dd>
              </div>
              <div>
                <dt>{t("settings.ai.memoryCorrectionsLabel")}</dt>
                <dd>{t("settings.ai.memoryCorrectionsDescription")}</dd>
              </div>
            </dl>
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
