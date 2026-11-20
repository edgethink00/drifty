import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { aiProviderBrandMark } from "./AiProviderBrandMark";
import type { AiConnectionStatus } from "../ai-connection/AiConnectionStatusBar";
import { DRIFTY_CLOUD_MODEL_ID, driftyModelOptions, isSelectableManagedModel } from "./AiSetupDriftyModelOptions";
import { DeleteManagedModelModal } from "./DeleteManagedModelModal";
import { ModalPresence } from "../../components/ModalPresence";
import { AiConnectionTestAction } from "./AiConnectionTestAction";
import type { AiModelOption } from "./AiSetupModelDialogs";
import type { AiSetupSection } from "./AiSetupSectionCards";
import { ModelBeingUsedCard } from "./ModelBeingUsedCard";
import { type SettingsSelectOption } from "./SettingsSelect";
import { normalizeOpenAiCompatibleBaseUrl, type DriftyAiRoute, type LocalAiSetupState } from "./localAiSetup";
import { analysisModelDisplayLabel } from "./analysisModelSetup";
import { ANTHROPIC_MODEL_SUGGESTIONS, OPENAI_MODEL_SUGGESTIONS } from "./directProviderModels";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";
import { useLocalization } from "../localization/LocalizationContext";
import { localizeAiConnectionTestMessage, localizeAiStatusLabel } from "../localization/aiStatusTranslations";
import { AiResourceNote } from "./AiResourceNote";
import { managedModelResourceDescription } from "./managedModelPresentation";
import { managedLocalAiProgressValue } from "./managedLocalAiProgressText";
import { remainingLabelText } from "../loading/remainingEstimateCopy";
import { useRemainingEstimate } from "../loading/useRemainingEstimate";

const CUSTOM_ENDPOINT_MODEL_ID = "custom_endpoint";
type AiSetupModelBeingUsedProps = {
  readonly initialModelMenuOpen?: boolean;
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly driftyRoute: DriftyAiRoute;
  readonly localAiSetup: LocalAiSetupState;
  readonly managedLocalStatus: ManagedLocalAiStatus | null;
  readonly openRouterModelOptions: readonly AiModelOption[];
  readonly openRouterPrimaryModel: string;
  readonly selectedProvider: AiSetupSection;
  readonly cliPilotAccess?: boolean;
  readonly actionModelId: string | null;
  readonly connectionStatus: AiConnectionStatus;
  readonly connectionTestKind: "success" | "error" | null;
  readonly connectionTestMessage: string | null;
  readonly connectionTestRunning: boolean;
  readonly connectionTestDisabled: boolean;
  readonly cloudSubscribeActionDisabled: boolean;
  readonly cloudSubscribeActionLabel: string | null;
  readonly cloudSubscribeActionBusyLabel?: string | null;
  readonly cloudSubscribeActionBusy?: boolean;
  readonly cloudSelectable: boolean;
  readonly canManageBilling: boolean;
  readonly onDriftyRouteChange: (route: DriftyAiRoute) => void;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
  readonly onStartModel: (modelId: string) => void | Promise<void>;
  readonly onDeleteModel: (modelId: string) => void | Promise<void>;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onOpenRouterPrimaryModelChange: (modelId: string) => void;
  readonly onProviderChange: (provider: AiSetupSection) => void;
  readonly onTestConnection: () => void | Promise<void>;
  readonly onStartCloudSetup: () => void | Promise<void>;
};

export function AiSetupModelBeingUsed({
  initialModelMenuOpen,
  catalog,
  driftyRoute,
  localAiSetup,
  managedLocalStatus,
  openRouterModelOptions,
  openRouterPrimaryModel,
  selectedProvider,
  cliPilotAccess = false,
  actionModelId,
  connectionStatus,
  connectionTestKind,
  connectionTestMessage,
  connectionTestRunning,
  connectionTestDisabled,
  cloudSubscribeActionDisabled,
  cloudSubscribeActionLabel,
  cloudSubscribeActionBusyLabel = null,
  cloudSubscribeActionBusy = false,
  cloudSelectable,
  canManageBilling,
  onDriftyRouteChange,
  onInstallModel,
  onStartModel,
  onDeleteModel,
  onLocalAiSetupChange,
  onManageCloudBilling,
  onOpenRouterPrimaryModelChange,
  onProviderChange,
  onTestConnection,
  onStartCloudSetup,
}: AiSetupModelBeingUsedProps) {
  const { effectiveLanguage, t } = useLocalization();
  // Deleting an installed local model is destructive, so a dropdown click only
  // *requests* deletion — the actual delete runs after a confirmation dialog.
  const [pendingDelete, setPendingDelete] = useState<{ readonly id: string; readonly label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const requestDeleteModel = (modelId: string) => {
    const model = catalog.find((item) => item.id === modelId);
    setPendingDelete({ id: modelId, label: model?.label ?? modelId });
  };
  const confirmDeleteModel = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDeleteModel(pendingDelete.id);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };
  const localizedConnectionStatus = {
    label: localizeAiStatusLabel(connectionStatus.label, t),
    providerLabel: localizeAiStatusLabel(connectionStatus.providerLabel, t),
  };
  const managedRuntimeOwnsStatusMessage = selectedProvider === "drifty"
    && driftyRoute === "local"
    && connectionStatus.tone === "error";
  const localizedConnectionTestMessage = connectionTestMessage && connectionTestKind
    ? localizeAiConnectionTestMessage(connectionTestMessage, connectionTestKind, effectiveLanguage, t)
    : connectionTestMessage;
  // Same estimate and wording the onboarding download and the sidebar use, so a
  // single transfer never reads differently depending on where you watch it.
  const downloadRemainingLabel = remainingLabelText(
    useRemainingEstimate({
      enabled: managedLocalStatus?.state === "installing",
      resetKey: managedLocalStatus?.selectedModelId ?? "",
      value: managedLocalStatus?.state === "installing"
        ? managedLocalAiProgressValue(managedLocalStatus.progress)
        : null,
    }),
    t,
  );
  const providerOptions = [
    ...((cliPilotAccess || selectedProvider === "codex_cli" || selectedProvider === "claude_cli") ? [{ value: "claude_cli" as const, label: "Claude Code", icon: aiProviderBrandMark("claude_cli", { pick: true }) }, { value: "codex_cli" as const, label: "Codex CLI", icon: aiProviderBrandMark("codex_cli", { pick: true }) }] : []),
    { value: "drifty", label: "Drifty", icon: aiProviderBrandMark("drifty", { pick: true }) },
    { value: "openrouter", label: "OpenRouter", icon: aiProviderBrandMark("openrouter", { pick: true }), muted: localAiSetup.openRouterApiKey.trim().length === 0 },
    { value: "openai", label: "OpenAI", icon: aiProviderBrandMark("openai", { pick: true }), muted: !(localAiSetup.openaiApiKey.trim() && localAiSetup.openaiModel.trim()) },
    { value: "anthropic", label: "Anthropic", icon: aiProviderBrandMark("anthropic", { pick: true }), muted: !(localAiSetup.anthropicApiKey.trim() && localAiSetup.anthropicModel.trim()) },
    { value: "custom", label: t("settings.ai.customEndpoint"), icon: aiProviderBrandMark("custom", { pick: true }), muted: !(normalizeOpenAiCompatibleBaseUrl(localAiSetup.selfHostedBaseUrl) && localAiSetup.selfHostedModel.trim().length > 0) },
  ] satisfies readonly SettingsSelectOption<AiSetupSection>[];
  const selectedModelValue = (() => {
    switch (selectedProvider) {
      case "codex_cli":
      case "claude_cli":
        return selectedProvider;
      case "drifty":
        return driftyRoute === "cloud" ? DRIFTY_CLOUD_MODEL_ID : localAiSetup.managedLocalModelId;
      case "openrouter":
        return openRouterPrimaryModel;
      case "openai":
        return localAiSetup.openaiModel;
      case "anthropic":
        return localAiSetup.anthropicModel;
      case "custom":
        return CUSTOM_ENDPOINT_MODEL_ID;
      default:
        return assertNever(selectedProvider);
    }
  })();
  const modelOptions = (() => {
    switch (selectedProvider) {
      case "codex_cli":
      case "claude_cli":
        return [{ value: selectedProvider, label: t("onboarding.cli.defaultModel") }];
      case "drifty":
        return driftyModelOptions({
          catalog,
          status: managedLocalStatus,
          recoveryModelId: initialModelMenuOpen && driftyRoute === "local" ? localAiSetup.managedLocalModelId : undefined,
          actionModelId,
          cloudSubscribeActionDisabled,
          cloudSubscribeActionLabel,
          cloudSubscribeActionBusyLabel,
          cloudSubscribeActionBusy,
          cloudSelectable,
          canManageBilling,
          onInstallModel,
          onStartModel,
          onStartCloudSetup,
          onManageCloudBilling,
          onDeleteModel: requestDeleteModel,
          onRevealArtifact: revealManagedModelArtifact,
          downloadRemainingLabel,
          t,
        });
      case "openrouter":
        return openRouterModelOptions.map((option) => ({ value: option.id, label: option.label }) satisfies SettingsSelectOption<string>);
      case "openai":
        return directModelOptions(localAiSetup.openaiModel, OPENAI_MODEL_SUGGESTIONS);
      case "anthropic":
        return directModelOptions(localAiSetup.anthropicModel, ANTHROPIC_MODEL_SUGGESTIONS);
      case "custom":
        return [{ value: CUSTOM_ENDPOINT_MODEL_ID, label: t("settings.ai.customEndpoint") } satisfies SettingsSelectOption<string>];
      default:
        return assertNever(selectedProvider);
    }
  })();

  const handleProviderChange = (provider: AiSetupSection) => {
    onProviderChange(provider);
  };
  const selectedLocalModel = catalog.find((model) => model.id === localAiSetup.managedLocalModelId);

  const handleModelChange = (modelId: string) => {
    switch (selectedProvider) {
      case "codex_cli":
      case "claude_cli":
        return;
      case "drifty":
        if (modelId === DRIFTY_CLOUD_MODEL_ID) {
          // Cloud is selectable on active AND trialing plans (trialing still shows an
          // Upgrade action). Only bail when it genuinely can't be used yet.
          if (!cloudSelectable) return;
          onDriftyRouteChange("cloud");
          onProviderChange("drifty");
          return;
        }
        if (!isSelectableManagedModel(modelId, managedLocalStatus)) return;
        onDriftyRouteChange("local");
        onProviderChange("drifty");
        onLocalAiSetupChange((current) => ({
          ...current,
          provider: "managed_local",
          driftyRoute: "local",
          managedLocalModelId: modelId,
          // Do not let the automatic probe pair the newly selected model id
          // with the previous model's endpoint identity while the switch is
          // still in flight. startModel fills both fields from native status.
          managedLocalBaseUrl: current.managedLocalModelId === modelId ? current.managedLocalBaseUrl : "",
          managedLocalModel: current.managedLocalModelId === modelId ? current.managedLocalModel : "",
        }));
        void onStartModel(modelId);
        return;
      case "openrouter":
        onProviderChange("openrouter");
        onLocalAiSetupChange((current) => ({ ...current, provider: "openrouter_byok" }));
        onOpenRouterPrimaryModelChange(modelId);
        return;
      case "openai":
        onProviderChange("openai");
        onLocalAiSetupChange((current) => ({ ...current, provider: "openai", openaiModel: modelId }));
        return;
      case "anthropic":
        onProviderChange("anthropic");
        onLocalAiSetupChange((current) => ({ ...current, provider: "anthropic", anthropicModel: modelId }));
        return;
      case "custom":
        onProviderChange("custom");
        onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted" }));
        return;
      default:
        return assertNever(selectedProvider);
    }
  };

  return (
    <>
    <ModelBeingUsedCard
      initialModelMenuOpen={initialModelMenuOpen && selectedProvider === "drifty" && driftyRoute === "local" && managedLocalStatus !== null}
      regionAriaLabel={t("settings.ai.modelBeingUsed")}
      heading={t("settings.ai.modelAria")}
      connectionAction={
        <AiConnectionTestAction running={connectionTestRunning} disabled={connectionTestDisabled} onTest={onTestConnection} />
      }
      tone={connectionStatus.tone}
      statusLabel={localizedConnectionStatus.label}
      statusProviderLabel={localizedConnectionStatus.providerLabel}
      statusAriaLabel={t("settings.ai.statusAria", {
        status: localizedConnectionStatus.label,
        provider: localizedConnectionStatus.providerLabel,
      })}
      providerAriaLabel={t("settings.ai.providerAria")}
      providerValue={selectedProvider}
      providerOptions={providerOptions}
      onProviderChange={(value) => handleProviderChange(value as AiSetupSection)}
      modelAriaLabel={t("settings.ai.modelAria")}
      modelValue={selectedModelValue}
      modelOptions={modelOptions}
      onModelChange={handleModelChange}
      statusMessage={managedRuntimeOwnsStatusMessage
        ? localizedConnectionStatus.label
        : connectionTestRunning ? null : localizedConnectionTestMessage}
      statusMessageKind={managedRuntimeOwnsStatusMessage
        ? (connectionStatus.tone === "error" ? "error" : null)
        : connectionTestKind}
    />
    {selectedProvider === "drifty" && driftyRoute === "local" ? (
      <div className="ai-model-resource-summary">
        {selectedLocalModel ? (
          <p className="ai-model-resource-summary__facts">{managedModelResourceDescription(selectedLocalModel, t)}</p>
        ) : null}
        <p className="ai-model-resource-summary__quality">{t("settings.ai.localQuality")}</p>
        <details className="ai-model-resource-summary__details">
          <summary>{t("settings.ai.localResourceDetails")}</summary>
          <AiResourceNote route={driftyRoute} />
        </details>
      </div>
    ) : null}
    <ModalPresence>
      {pendingDelete ? (
      <DeleteManagedModelModal
        modelLabel={pendingDelete.label}
        deleting={deleting}
        onCancel={() => (deleting ? undefined : setPendingDelete(null))}
        onConfirm={() => void confirmDeleteModel()}
      />
      ) : null}
    </ModalPresence>
    </>
  );
}

/** Suggested models, plus a typed id the suggestions do not include so the picker can show it. */
function directModelOptions(current: string, suggestions: readonly string[]): SettingsSelectOption<string>[] {
  const ids = !current.trim() || suggestions.includes(current) ? [...suggestions] : [current, ...suggestions];
  return ids.map((id) => ({ value: id, label: analysisModelDisplayLabel(id) }));
}

/** Reveal an installed managed-model's on-disk directory in Finder. */
async function revealManagedModelArtifact(artifactDir: string): Promise<void> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(artifactDir);
}

class AiSetupModelProviderError extends Error {
  constructor(readonly provider: string) {
    super(`Unhandled AI model provider: ${provider}`);
    this.name = "AiSetupModelProviderError";
  }
}

function assertNever(value: never): never {
  throw new AiSetupModelProviderError(String(value));
}
