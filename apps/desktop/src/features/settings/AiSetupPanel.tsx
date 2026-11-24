import type { ProviderCredentialRecoveries } from "./useProviderKeyPersistence";
import { useCliPilot } from "../onboarding/useCliPilot";
import { analysisConnectionLabel, resolveSharedAnalysisSetup } from "./sharedAiConnection";
import type { MemorySuggestionProvider } from "./useMemorySuggestions";
import { useSettingsSearch } from "./SettingsSearchContext";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";

import type { AiConnectionStatus } from "../ai-connection/AiConnectionStatusBar";
import type { BillingPlanId } from "../billing/billingService";
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
import { DirectProviderConnectionFields, type DirectProviderId } from "./DirectProviderConnectionFields";
import { ANTHROPIC_MODEL_SUGGESTIONS, DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL, OPENAI_MODEL_SUGGESTIONS } from "./directProviderModels";
import { OpenRouterSetupPanel } from "./OpenRouterSetupPanel";
import {
  LOCAL_AI_SETUP_STORAGE_KEY,
  normalizeOpenAiCompatibleBaseUrl,
  type DriftyAiRoute,
  type LocalAiSetupState,
} from "./localAiSetup";
import { isActiveProviderTestable, providerForSection, sectionForProvider } from "./aiSetupProviderSelection";
import { AiSetupSupportSections } from "./AiSetupSupportSections";
import { IntelligenceSetupPanel } from "./IntelligenceSetupPanel";
import type { AiSettingsSection } from "./SettingsSidebar";
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
import { ActionLabel } from "../../components/ActionLabel";
import { SettingsRowDescription } from "./SettingsRowDescription";
import type { CustomEndpointAddressRepair } from "../ai-connection/customEndpointAddressRepair";

type CloudSetupHandler = (billingInterval?: BillingInterval) => void | Promise<void>;

function setupSection<Id extends AiSetupSection>(id: Id) {
  return AI_SETUP_SECTIONS.find((section) => section.id === id)!;
}

const AI_SECTION_TITLE_KEYS = {
  aiSetup: "settings.ai.connectionTitle",
  intelligence: "settings.ai.connectionTitle",
  memory: "settings.ai.profile",
} as const satisfies Record<AiSettingsSection, string>;

export type AiSetupPanelProps = {
  /** Which AI settings section the sidebar opened: classification model, project analysis model, or Memory. */
  readonly section: AiSettingsSection;
  readonly initialModelMenuOpen?: boolean;
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
  readonly providerCredentials?: ProviderCredentialRecoveries;
  readonly connectionTest: UseAiConnectionTestRunnerResult;
  readonly shouldShowCloudCheckoutPlans: boolean;
  readonly workProfileUserId: string;
  /** Provider that writes Memory suggestions (local, bring-your-own or Drifty Cloud); null when none is selected. */
  readonly memorySuggestionProvider?: MemorySuggestionProvider | null;
  /** My classifications, shown as the Memory section's last block. */
  readonly memoryRulesSection?: ReactNode;
  /** Automatic memory (Work memory beta), shown as the Memory section's first blocks. */
  readonly automaticMemorySection?: ReactNode;
  readonly analysisSetup: AnalysisAiSetupState;
  readonly effectiveAnalysisSetup?: AnalysisAiSetupState;
  readonly onAnalysisProviderVisible?: (provider: AnalysisAiSetupState["provider"]) => void;
  readonly analysisOpenRouterConnected: boolean;
  readonly onAnalysisChange: (next: AnalysisAiSetupState) => void;
  readonly onDialogOpenChange: (open: boolean) => void;
  /** Edits an OpenAI or Anthropic key, which live in the OS credential store rather than in setup state. */
  readonly onDirectKeyChange?: (provider: DirectProviderId, value: string) => void;
  /** Reads a stored key when its provider is picked or its card is opened. */
  readonly onDirectKeyVisible?: (provider: DirectProviderId) => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onStartCloudSetup: CloudSetupHandler;
  /** The custom endpoint address Drifty repaired, shown with undo while it is still the base URL. */
  readonly customEndpointAddressRepair?: CustomEndpointAddressRepair | null;
  readonly onCustomEndpointAddressRepaired?: (from: string, to: string) => void;
  readonly onUndoCustomEndpointAddressRepair?: () => void;
  readonly onDismissCustomEndpointAddressRepair?: () => void;
};

export function AiSetupPanel({
  section,
  initialModelMenuOpen,
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
  providerCredentials,
  connectionTest,
  shouldShowCloudCheckoutPlans,
  workProfileUserId,
  memorySuggestionProvider,
  memoryRulesSection,
  automaticMemorySection,
  analysisSetup,
  effectiveAnalysisSetup,
  onAnalysisProviderVisible,
  analysisOpenRouterConnected,
  onAnalysisChange,
  onDialogOpenChange,
  onDirectKeyChange,
  onDirectKeyVisible,
  onLocalAiSetupChange,
  onManageCloudBilling,
  onStartCloudSetup,
  customEndpointAddressRepair = null,
  onCustomEndpointAddressRepaired,
  onUndoCustomEndpointAddressRepair,
  onDismissCustomEndpointAddressRepair,
}: AiSetupPanelProps) {
  const { t } = useLocalization();
  const { request: searchRequest } = useSettingsSearch();
  const cliPilotAccess = useCliPilot(workProfileUserId, workProfileUserId !== "local", false, false) === "cli";
  const selectedSection = sectionForProvider(localAiSetup.provider);
  // Which provider panel is expanded. Defaults to the active provider — Drifty on
  // a fresh install, or OpenRouter once the user has switched their primary to it.
  const [expandedSection, setExpandedSection] = useState<AiSetupSection | null>(() => sectionForProvider(localAiSetup.provider));
  useEffect(() => {
    if (!searchRequest || searchRequest.entry.section !== "aiSetup") return;
    const { aiProvider } = searchRequest.entry;
    if (aiProvider) setExpandedSection(aiProvider);
  }, [searchRequest]);
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
    ? t("billing.trialActivation.start")
    : cloudShowsUpgrade
    ? t("settings.ai.upgrade")
    : null;
  // Starting the trial or opening checkout shows inside the same button with a
  // spinner; the button keeps the wider of its labels (2026-10-21 billing rule).
  const cloudSubscribeActionBusyLabel = cloudSubscribeActionLabel === null || cloudNeedsSignIn || cloudDeviceLimited
    ? null
    : cloudTrialAvailable
    ? t("billing.trialActivation.starting")
    : t("billing.plan.opening");
  const cloudSubscribeActionBusy = cloudSubscribeActionBusyLabel !== null
    && (cloudTrialAvailable ? cloudTrialStarting : billingCheckoutLoadingInterval !== null);
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
  const clearTestResult = connectionTest.clearResult;
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
    clearTestResult();
  }, [connectionStatus.tone, clearTestResult, connectionTestKind, isCloudRouteSelected]);

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
      case "openai":
        return Boolean(localAiSetup.openaiApiKey.trim() && localAiSetup.openaiModel.trim());
      case "anthropic":
        return Boolean(localAiSetup.anthropicApiKey.trim() && localAiSetup.anthropicModel.trim());
      case "custom":
        return Boolean(normalizeOpenAiCompatibleBaseUrl(localAiSetup.selfHostedBaseUrl) && localAiSetup.selfHostedModel.trim());
      default:
        return true;
    }
  };

  const handleProviderChange = (section: AiSetupSection) => {
    clearConnectionTestResult();
    if (section === "openai" || section === "anthropic") onDirectKeyVisible?.(section);
    // Always reveal the provider's Configure card; only commit to it once it's ready.
    // Picking an unconfigured provider just expands its card so it can be set up first.
    setExpandedSection(section);
    if (sectionReady(section)) selectProvider(section);
  };

  const handleToggleSection = (section: AiSetupSection) => {
    clearConnectionTestResult();
    const willExpand = expandedSection !== section;
    if (willExpand && (section === "openai" || section === "anthropic")) onDirectKeyVisible?.(section);
    setExpandedSection(willExpand ? section : null);
  };

  // Typing a key activates its provider, as the OpenRouter and custom endpoint fields do.
  const changeDirectKey = (provider: DirectProviderId, value: string) => {
    clearConnectionTestResult();
    onDirectKeyChange?.(provider, value);
    onLocalAiSetupChange((current) => ({ ...current, provider }));
  };

  const handleTestConnection = async () => {
    preserveCloudProbeErrorRef.current = isCloudRouteSelected && connectionStatus.tone === "ok";
    await connectionTest.run();
  };

  // A separate project/title model is no longer offered. It stays visible only for
  // a connection that already saved one, until that person returns to the default.
  const hasProjectOverride = analysisSetup.selectionSource !== "automatic";
  const analysisRoute = effectiveAnalysisSetup ?? analysisSetup;
  // Cloud recovery sends project analysis somewhere other than the saved choice,
  // so it stays visible by task. A saved override shows its destination as a hint
  // beside its collapsed toggle.
  const analysisRecovering = analysisRoute.provider !== analysisSetup.provider;
  const analysisDestinationHint = hasProjectOverride || analysisRecovering
    ? analysisConnectionLabel(analysisRoute)
    : null;
  const trialRowShown = section !== "memory" && cloudTrialAvailable && !cloudNeedsPlanCheck && !cloudStatusRefreshing;
  const trialFailure = cloudTrialError || trialRequestError || null;

  return (
    <div className="settings-block ai-setup-panel">
      <div className="ai-setup-panel__header">
        <h3>{t(AI_SECTION_TITLE_KEYS[section])}</h3>
      </div>

      {trialRowShown ? <div className="settings-row">
        <div>
          <div className="lbl">{t("billing.trialActivation.available")}</div>
          {/* A failed start takes the description's place, so the providers
              below stay where they are. */}
          <SettingsRowDescription description={t("billing.trialActivation.availableBody")} notice={trialFailure} />
        </div>
        <button type="button" className="settings-btn primary" disabled={cloudSubscribeActionDisabled || !onStartCloudTrial}
          aria-busy={cloudSubscribeActionBusy} onClick={() => void handleCloudSetup(section === "intelligence" && hasProjectOverride ? "intelligence" : "classification")}>
          <ActionLabel busy={cloudSubscribeActionBusy} busyLabel={cloudSubscribeActionBusyLabel ?? undefined}>{cloudSubscribeActionLabel}</ActionLabel>
        </button>
      </div> : null}
      {section !== "memory" && !trialRowShown && trialFailure ? <p role="alert" className="account-plan-notice__error">{trialFailure}</p> : null}

      {section !== "memory" ? (
        <section className="ai-setup-tab-panel" aria-label={t("settings.ai.providers")}>
          <div data-setting-id="settings.ai.modelBeingUsed">
          <div data-setting-id={hasProjectOverride ? undefined : "settings.ai.intelligence"}>
          <AiSetupModelBeingUsed
            initialModelMenuOpen={initialModelMenuOpen}
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
            cliPilotAccess={cliPilotAccess}
            cloudSubscribeActionDisabled={cloudSubscribeActionDisabled}
            cloudSubscribeActionLabel={cloudSubscribeActionLabel}
            cloudSubscribeActionBusyLabel={cloudSubscribeActionBusyLabel}
            cloudSubscribeActionBusy={cloudSubscribeActionBusy}
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
          </div>
          {customEndpointAddressRepair
            && localAiSetup.provider === "self_hosted"
            && localAiSetup.selfHostedBaseUrl === customEndpointAddressRepair.to ? (
            <p className="ai-setup-endpoint-repair" role="status">
              <span>{t("settings.ai.endpointAddressRepaired", { url: customEndpointAddressRepair.to })}</span>
              {onUndoCustomEndpointAddressRepair ? (
                <button type="button" className="settings-inline-link ai-setup-endpoint-repair__action" onClick={onUndoCustomEndpointAddressRepair}>
                  {t("settings.ai.endpointAddressRepairUndo")}
                </button>
              ) : null}
              {onDismissCustomEndpointAddressRepair ? (
                <button type="button" className="settings-inline-link ai-setup-endpoint-repair__action" onClick={onDismissCustomEndpointAddressRepair}>
                  {t("settings.ai.endpointAddressRepairDismiss")}
                </button>
              ) : null}
            </p>
          ) : null}
          <AiSetupConnectionDetails ariaLabel={t("settings.ai.setupChoicesAria")}>
            <div data-setting-id="settings.ai.openRouterApiKey">
            <AiSetupSectionCard section={setupSection("openrouter")} expanded={expandedSection === "openrouter"} onToggle={handleToggleSection}>
              <OpenRouterSetupPanel
                credentialRecovery={providerCredentials?.openrouter_byok}
                localAiSetup={localAiSetup}
                onChooseModels={() => modelPickers.setOpenRouterModelPickerOpen(true)}
                onLocalAiSetupChange={onLocalAiSetupChange}
              />
            </AiSetupSectionCard>
            </div>
            <div data-setting-id="settings.ai.openAiApiKey">
            <AiSetupSectionCard section={setupSection("openai")} expanded={expandedSection === "openai"} onToggle={handleToggleSection}>
              <DirectProviderConnectionFields
                provider="openai"
                credentialRecovery={providerCredentials?.openai}
                groupAriaLabel={t("settings.ai.openAiSettingsAria")}
                apiKey={localAiSetup.openaiApiKey}
                model={localAiSetup.openaiModel}
                defaultModel={DEFAULT_OPENAI_MODEL}
                suggestions={OPENAI_MODEL_SUGGESTIONS}
                datalistId="connection-openai-model-options"
                onApiKeyChange={(value) => changeDirectKey("openai", value)}
                onModelChange={(openaiModel) => onLocalAiSetupChange((current) => ({ ...current, provider: "openai", openaiModel }))}
              />
            </AiSetupSectionCard>
            </div>
            <div data-setting-id="settings.ai.anthropicApiKey">
            <AiSetupSectionCard section={setupSection("anthropic")} expanded={expandedSection === "anthropic"} onToggle={handleToggleSection}>
              <DirectProviderConnectionFields
                provider="anthropic"
                credentialRecovery={providerCredentials?.anthropic}
                groupAriaLabel={t("settings.ai.anthropicSettingsAria")}
                apiKey={localAiSetup.anthropicApiKey}
                model={localAiSetup.anthropicModel}
                defaultModel={DEFAULT_ANTHROPIC_MODEL}
                suggestions={ANTHROPIC_MODEL_SUGGESTIONS}
                datalistId="connection-anthropic-model-options"
                onApiKeyChange={(value) => changeDirectKey("anthropic", value)}
                onModelChange={(anthropicModel) => onLocalAiSetupChange((current) => ({ ...current, provider: "anthropic", anthropicModel }))}
              />
            </AiSetupSectionCard>
            </div>
            <div data-setting-id="settings.ai.customEndpoint">
            <AiSetupSectionCard section={setupSection("custom")} expanded={expandedSection === "custom"} onToggle={handleToggleSection}>
              <CustomEndpointSetupPanel
                credentialRecovery={providerCredentials?.self_hosted}
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
                {...(onCustomEndpointAddressRepaired
                  ? {
                      onAddressRepaired: (from: string, to: string) => {
                        onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedBaseUrl: to }));
                        onCustomEndpointAddressRepaired(from, to);
                      },
                    }
                  : {})}
              />
            </AiSetupSectionCard>
            </div>
          </AiSetupConnectionDetails>
          {analysisRecovering ? (
            <section className="ai-task-connection-summary" aria-label={t("settings.ai.taskConnections")}>
              <div className="settings-row"><div className="lbl">{t("settings.ai.classification")}</div><span>{analysisConnectionLabel(resolveSharedAnalysisSetup(analysisSetup, localAiSetup, false))}</span></div>
              <div className="settings-row"><div className="lbl">{t("settings.ai.intelligenceTasks")}</div><span>{analysisConnectionLabel(analysisRoute)}</span></div>
            </section>
          ) : null}
          {hasProjectOverride ? <details className="ai-setup-advanced" open>
            <summary>
              {t("settings.ai.advancedIntelligence")}
              {analysisDestinationHint ? <span className="ai-setup-advanced__hint">{analysisDestinationHint}</span> : null}
            </summary>
            <label className="settings-row ai-setup-default-toggle"><span><span className="lbl">{t("settings.ai.sharedDefault")}</span><span className="desc">{t("settings.ai.sharedDefaultBody")}</span></span>
              <input type="checkbox" aria-label={t("settings.ai.sharedDefault")} checked={false}
                onChange={event => { if (event.target.checked) onAnalysisChange({ ...analysisSetup, selectionSource: "automatic" }); }} />
            </label>
          <IntelligenceSetupPanel
            providerCredentials={providerCredentials}
            setup={analysisSetup}
            showLocalQuality={localAiSetup.provider !== "managed_local" || driftyRoute !== "local"}
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
            cloudSubscribeActionBusyLabel={cloudSubscribeActionBusyLabel}
            cloudSubscribeActionBusy={cloudSubscribeActionBusy}
            canManageBilling={cloudCanManageBilling}
            onStartCloudSetup={() => handleCloudSetup("intelligence")}
            onManageCloudBilling={onManageCloudBilling}
          />
          </details> : null}
        </section>
      ) : (
        <section className="ai-setup-tab-panel" aria-label={t("settings.ai.profile")}>
          {automaticMemorySection}
          {/* With automatic memory above, the rest of the page is a separate feature: what classification refers to.
              Its head matches "Automatic memory"; the space above it, not a rule or a description, marks the split. */}
          {automaticMemorySection ? (
            <header className="ai-setup-memory-group">
              <h3>{t("settings.ai.classificationMemory")}</h3>
            </header>
          ) : null}
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
              onResetWorkProfileDraft={workProfileSettings.resetWorkProfileDraft}
              rulesSection={memoryRulesSection}
            />
          </div>
        </section>
      )}

      <ModalPresence explicitTabNavigation>
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
