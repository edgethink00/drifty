import type { MemorySuggestionProvider } from "./useMemorySuggestions";
import { useSettingsSearch } from "./SettingsSearchContext";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { AiConnectionStatus } from "../ai-connection/AiConnectionStatusBar";
import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";
import { OpenRouterModelDialog } from "./AiSetupModelDialogs";
import { ModalPresence } from "../../components/ModalPresence";
import "./AiSetupPanel.css";
import {
  AI_SETUP_SECTIONS,
  AiSetupSectionCard,
  AiSetupConnectionDetails,
  type AiSetupSection,
} from "./AiSetupSectionCards";
import { AiSetupModelBeingUsed } from "./AiSetupModelBeingUsed";
import { CustomEndpointSetupPanel } from "./CustomEndpointSetupPanel";
import { OpenRouterSetupPanel } from "./OpenRouterSetupPanel";
import {
  LOCAL_AI_SETUP_STORAGE_KEY,
  normalizeOpenAiCompatibleBaseUrl,
  type DriftyAiRoute,
  type LocalAiSetupState,
} from "./localAiSetup";
import { isActiveProviderTestable, providerForSection, sectionForProvider } from "./aiSetupProviderSelection";
import { AiSetupSupportSections } from "./AiSetupSupportSections";
import { AiSetupPanelTabs, type AiSetupPanelTab } from "./AiSetupPanelTabs";
import { IntelligenceSetupPanel } from "./IntelligenceSetupPanel";
import {
  ANALYSIS_AI_SETUP_STORAGE_KEY,
  toPersistedAnalysisAiSetup,
  type AnalysisAiSetupState,
} from "./analysisModelSetup";
import { persistLocalAiSetup } from "./useAiSetupController";
import { useManagedLocalAiSetup } from "./useManagedLocalAiSetup";
import { useAiSetupModelPickers } from "./useAiSetupModelPickers";
import { useWorkProfileSettings } from "./useWorkProfileSettings";
import type { UseAiConnectionTestRunnerResult } from "./useAiConnectionTestRunner";
import { useLocalization } from "../localization/LocalizationContext";
import { canStartIndividualCheckout } from "../billing/billingEligibility";

type CloudSetupHandler = (billingInterval?: BillingInterval) => void | Promise<void>;

export type AiSetupPanelProps = {
  readonly cloudTrialAvailable?: boolean;
  readonly cloudTrialStarting?: boolean;
  readonly cloudTrialError?: string | null;
  readonly onStartCloudTrial?: () => Promise<boolean>;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingEntitlementOwner?: BillingEntitlement["entitlementOwner"];
  readonly billingEntitlementLockedReason?: BillingEntitlement["lockedReason"];
  readonly billingEntitlementError?: string | null;
  readonly onRefreshCloudStatus?: () => void | Promise<unknown>;
  readonly onManageCloudDevices?: () => void;
  readonly billingPlansDisabled: boolean;
  readonly cloudStatusRefreshing: boolean;
  readonly connectionStatus: AiConnectionStatus;
  readonly currentBillingPlan: BillingPlanId | null;
  readonly localAiSetup: LocalAiSetupState;
  readonly connectionTest: UseAiConnectionTestRunnerResult;
  readonly shouldShowCloudCheckoutPlans: boolean;
  readonly workProfileUserId: string;
  /** Provider that writes Memory suggestions (local, bring-your-own or Drifty Cloud); null when none is selected. */
  readonly memorySuggestionProvider?: MemorySuggestionProvider | null;
  readonly analysisSetup: AnalysisAiSetupState;
  readonly effectiveAnalysisSetup?: AnalysisAiSetupState;
  readonly onAnalysisProviderVisible?: (provider: AnalysisAiSetupState["provider"]) => void;
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
  cloudTrialAvailable = false,
  cloudTrialStarting = false,
  cloudTrialError = null,
  onStartCloudTrial,
  billingCheckoutLoadingInterval,
  billingEntitlementStatus,
  billingEntitlementLockedReason,
  billingEntitlementError = null,
  onManageCloudDevices,
  billingPlansDisabled,
  cloudStatusRefreshing,
  connectionStatus,
  currentBillingPlan,
  localAiSetup,
  connectionTest,
  shouldShowCloudCheckoutPlans,
  workProfileUserId,
  memorySuggestionProvider,
  analysisSetup,
  effectiveAnalysisSetup,
  onAnalysisProviderVisible,
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
  const { request: searchRequest } = useSettingsSearch();
  const selectedSection = sectionForProvider(localAiSetup.provider);
  // Which provider panel is expanded. Defaults to the active provider — Drifty on
  // a fresh install, or OpenRouter once the user has switched their primary to it.
  const [expandedSection, setExpandedSection] = useState<AiSetupSection | null>(() => sectionForProvider(localAiSetup.provider));
  const [activePanelTab, setActivePanelTab] = useState<AiSetupPanelTab>("providers");
  useEffect(() => {
    if (!searchRequest || searchRequest.entry.section !== "aiSetup") return;
    const { aiTab, aiProvider } = searchRequest.entry;
    if (aiTab && (aiTab !== "intelligence" || showIntelligenceTab)) setActivePanelTab(aiTab);
    if (aiProvider) setExpandedSection(aiProvider);
  }, [searchRequest, showIntelligenceTab]);
  const driftyRoute = localAiSetup.driftyRoute;
  const modelPickers = useAiSetupModelPickers(localAiSetup, onLocalAiSetupChange);
  // The Drifty provider has no card any more — its cloud/local models are managed
  // entirely from the Model-being-used dropdown, so load the managed-local catalog
  // whenever Drifty is the active provider (rather than when a card is expanded).
  const managedLocalAi = useManagedLocalAiSetup(selectedSection === "drifty", onLocalAiSetupChange);
  const workProfileSettings = useWorkProfileSettings(workProfileUserId);
  const canUseCloudModel = currentBillingPlan === "individual"
    && !shouldShowCloudCheckoutPlans
    && !cloudStatusRefreshing
    && !billingEntitlementError
    && (billingEntitlementStatus === "active" || billingEntitlementStatus === "trialing");
  const cloudIsTrialing = billingEntitlementStatus === "trialing";
  // Recover confirmed account blocks through billing or device management.
  // A failed plan read must be refreshed before offering a purchase.
  const cloudLocked = !cloudTrialAvailable && billingEntitlementStatus === "locked" && currentBillingPlan === "individual";
  const cloudNeedsPlanCheck = Boolean(billingEntitlementError)
    || (billingEntitlementStatus === null && currentBillingPlan !== "free");
  const cloudNeedsSignIn = billingEntitlementStatus === null && currentBillingPlan === "free";
  const cloudDeviceLimited = billingEntitlementLockedReason === "device_limit_reached";
  const cloudCanManageBilling = !cloudNeedsPlanCheck && !cloudStatusRefreshing && !cloudDeviceLimited
    && ((canUseCloudModel && !cloudIsTrialing) || cloudLocked);
  const cloudShowsUpgrade = canStartIndividualCheckout(billingEntitlementStatus === null ? null : {
    status: billingEntitlementStatus,
    lockedReason: billingEntitlementLockedReason
      ?? (billingEntitlementStatus === "locked" && currentBillingPlan !== "individual" ? "billing_missing" : undefined),
  });
  const cloudSubscribeActionLabel = cloudStatusRefreshing || cloudNeedsPlanCheck
    ? null
    : cloudNeedsSignIn
    ? t("account.signIn")
    : cloudDeviceLimited
    ? t("sidebar.cta.device.action")
    : cloudTrialAvailable
    ? t(cloudTrialStarting ? "billing.trialActivation.starting" : "billing.trialActivation.start")
    : cloudShowsUpgrade
    ? (billingCheckoutLoadingInterval === null ? t("settings.ai.upgrade") : t("settings.ai.opening"))
    : null;
  const cloudSubscribeActionDisabled = billingPlansDisabled || cloudStatusRefreshing || cloudTrialStarting || billingCheckoutLoadingInterval !== null
    || cloudNeedsPlanCheck || (cloudDeviceLimited && !onManageCloudDevices);
  const trialRequestRef = useRef(false);
  const trialRequestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const latestSelection = useRef({ workProfileUserId, localAiSetup, analysisSetup });
  latestSelection.current = { workProfileUserId, localAiSetup, analysisSetup };
  const [trialRequestError, setTrialRequestError] = useState<string | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      trialRequestGenerationRef.current += 1;
    };
  }, []);
  async function handleCloudSetup(target: "classification" | "intelligence") {
    if (cloudSubscribeActionDisabled) return;
    if (cloudDeviceLimited) { onManageCloudDevices?.(); return; }
    if (!cloudTrialAvailable) { await onStartCloudSetup(); return; }
    if (trialRequestRef.current || cloudSubscribeActionDisabled || !onStartCloudTrial) return;
    const snapshot = latestSelection.current;
    const requestGeneration = ++trialRequestGenerationRef.current;
    trialRequestRef.current = true;
    setTrialRequestError(null);
    try {
      if (target === "classification") {
        if (!persistLocalAiSetup(snapshot.localAiSetup)) throw new CloudSetupPersistenceError(LOCAL_AI_SETUP_STORAGE_KEY);
      } else if (!persistAnalysisAiSetup(snapshot.analysisSetup)) {
        throw new CloudSetupPersistenceError(ANALYSIS_AI_SETUP_STORAGE_KEY);
      }
      if (!await onStartCloudTrial()) return;
      if (!mountedRef.current || trialRequestGenerationRef.current !== requestGeneration) return;
      const current = latestSelection.current;
      if (current.workProfileUserId !== snapshot.workProfileUserId) return;
      if (target === "classification" && current.localAiSetup === snapshot.localAiSetup) {
        const nextSetup = { ...current.localAiSetup, provider: "managed_local" as const, driftyRoute: "cloud" as const };
        const persisted = persistLocalAiSetup(nextSetup);
        onLocalAiSetupChange(nextSetup);
        if (!persisted) throw new CloudSetupPersistenceError(LOCAL_AI_SETUP_STORAGE_KEY);
      } else if (target === "intelligence" && current.analysisSetup === snapshot.analysisSetup) {
        const nextSetup = { ...current.analysisSetup, provider: "cloud" as const };
        const persisted = persistAnalysisAiSetup(nextSetup);
        onAnalysisChange(nextSetup);
        if (!persisted) throw new CloudSetupPersistenceError(ANALYSIS_AI_SETUP_STORAGE_KEY);
      }
    } catch {
      if (mountedRef.current
        && trialRequestGenerationRef.current === requestGeneration
        && latestSelection.current.workProfileUserId === snapshot.workProfileUserId) {
        setTrialRequestError(t("billing.trialActivation.failed"));
      }
    } finally {
      if (trialRequestGenerationRef.current === requestGeneration) trialRequestRef.current = false;
    }
  }
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
        return Boolean(normalizeOpenAiCompatibleBaseUrl(localAiSetup.selfHostedBaseUrl) && localAiSetup.selfHostedModel.trim());
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

      {cloudTrialAvailable && !cloudNeedsPlanCheck && !cloudStatusRefreshing ? <div className="settings-row">
        <div><div className="lbl">{t("billing.trialActivation.available")}</div><div className="desc">{t("billing.trialActivation.availableBody")}</div></div>
        <button type="button" className="settings-btn primary" disabled={cloudSubscribeActionDisabled || !onStartCloudTrial}
          aria-busy={cloudTrialStarting} onClick={() => void handleCloudSetup(activePanelTab === "intelligence" ? "intelligence" : "classification")}>
          {cloudSubscribeActionLabel}
        </button>
      </div> : null}
      {cloudTrialError || trialRequestError ? <p role="alert" className="account-plan-notice__error">{cloudTrialError || trialRequestError}</p> : null}
      <AiSetupPanelTabs activeTab={activePanelTab} onChange={setActivePanelTab} showIntelligenceTab={showIntelligenceTab} />

      {activePanelTab === "providers" ? (
        <section id="ai-setup-panel-tab-providers" className="ai-setup-tab-panel" role="tabpanel" aria-label={t("settings.ai.providers")}>
          <div data-setting-id="settings.ai.modelBeingUsed">
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
            onStartModel={managedLocalAi.startModel}
            onDeleteModel={managedLocalAi.deleteModel}
            onLocalAiSetupChange={onLocalAiSetupChange}
            onManageCloudBilling={onManageCloudBilling}
            onOpenRouterPrimaryModelChange={modelPickers.handleOpenRouterPrimaryModelChange}
            onProviderChange={handleProviderChange}
            onStartCloudSetup={() => handleCloudSetup("classification")}
            onTestConnection={handleTestConnection}
          />

          </div>
          <AiSetupConnectionDetails ariaLabel={t("settings.ai.setupChoicesAria")}>
            <div data-setting-id="settings.ai.openRouterApiKey">
            <AiSetupSectionCard section={AI_SETUP_SECTIONS[1]} expanded={expandedSection === "openrouter"} onToggle={handleToggleSection}>
              <OpenRouterSetupPanel
                localAiSetup={localAiSetup}
                onChooseModels={() => modelPickers.setOpenRouterModelPickerOpen(true)}
                onLocalAiSetupChange={onLocalAiSetupChange}
              />
            </AiSetupSectionCard>
            </div>
            <div data-setting-id="settings.ai.customEndpoint">
            <AiSetupSectionCard section={AI_SETUP_SECTIONS[2]} expanded={expandedSection === "custom"} onToggle={handleToggleSection}>
              <CustomEndpointSetupPanel
                baseUrl={localAiSetup.selfHostedBaseUrl}
                apiKey={localAiSetup.selfHostedApiKey}
                model={localAiSetup.selfHostedModel}
                sharingPartner="intelligence"
                baseUrlAriaLabel={t("settings.ai.customEndpointBaseUrlAria")}
                apiKeyAriaLabel={t("settings.ai.customEndpointApiKeyAria")}
                modelAriaLabel={t("settings.ai.customEndpointModelAria")}
                onBaseUrlChange={(selfHostedBaseUrl) => onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedBaseUrl }))}
                onApiKeyChange={(selfHostedApiKey) => onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedApiKey }))}
                onModelChange={(selfHostedModel) => onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedModel }))}
              />
            </AiSetupSectionCard>
            </div>
          </AiSetupConnectionDetails>
        </section>
      ) : activePanelTab === "intelligence" && showIntelligenceTab ? (
        <section data-setting-id="settings.ai.intelligence" id="ai-setup-panel-tab-intelligence" className="ai-setup-tab-panel" role="tabpanel" aria-label={t("settings.ai.intelligence")}>
          <IntelligenceSetupPanel
            setup={analysisSetup}
            effectiveSetup={effectiveAnalysisSetup}
            onProviderVisible={onAnalysisProviderVisible}
            onChange={onAnalysisChange}
            openRouterApiKey={localAiSetup.openRouterApiKey}
            onOpenRouterApiKeyChange={(openRouterApiKey) => onLocalAiSetupChange(current => ({ ...current, openRouterApiKey }))}
            onDialogOpenChange={onDialogOpenChange}
            openRouterConnected={analysisOpenRouterConnected}
            cloudSelectable={canUseCloudModel}
            cloudSubscribeActionLabel={cloudSubscribeActionLabel}
            cloudSubscribeActionDisabled={cloudSubscribeActionDisabled}
            canManageBilling={cloudCanManageBilling}
            onStartCloudSetup={() => handleCloudSetup("intelligence")}
            onManageCloudBilling={onManageCloudBilling}
          />
        </section>
      ) : (
        <section id="ai-setup-panel-tab-profile" className="ai-setup-tab-panel" role="tabpanel" aria-label={t("settings.ai.profile")}>
          <div className="ai-setup-support-zone" aria-label={t("settings.ai.promptSettings")}>
            <AiSetupSupportSections
              workProfileUserId={workProfileUserId}
              memorySuggestionProvider={memorySuggestionProvider ?? null}
              savedWorkProfile={workProfileSettings.savedWorkProfile}
              workProfileDraft={workProfileSettings.workProfileDraft}
              workProfileMessage={workProfileSettings.workProfileMessage}
              workProfileSaving={workProfileSettings.workProfileSaving}
              memorySnapshotVersion={workProfileSettings.memorySnapshotVersion}
              onSaveWorkProfile={workProfileSettings.handleSaveWorkProfile}
              onWorkProfileDraftChange={workProfileSettings.handleWorkProfileDraftChange}
            />
          </div>
        </section>
      )}

      <ModalPresence>
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
      </ModalPresence>
    </div>
  );
}

class CloudSetupPersistenceError extends Error {
  constructor(readonly storageKey: string) {
    super(`Unable to persist Cloud setup in ${storageKey}.`);
    this.name = "CloudSetupPersistenceError";
  }
}

function persistAnalysisAiSetup(setup: AnalysisAiSetupState): boolean {
  try {
    window.localStorage.setItem(ANALYSIS_AI_SETUP_STORAGE_KEY, JSON.stringify(toPersistedAnalysisAiSetup(setup)));
    return true;
  } catch {
    return false;
  }
}
