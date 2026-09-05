import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { aiProviderBrandMark } from "./AiProviderBrandMark";
import type { AiConnectionStatus } from "../ai-connection/AiConnectionStatusBar";
import { DRIFTY_CLOUD_MODEL_ID, driftyModelOptions, isSelectableManagedModel } from "./AiSetupDriftyModelOptions";
import { DeleteManagedModelModal } from "./DeleteManagedModelModal";
import type { AiModelOption } from "./AiSetupModelDialogs";
import type { AiSetupSection } from "./AiSetupSectionCards";
import { ModelBeingUsedCard } from "./ModelBeingUsedCard";
import { type SettingsSelectOption } from "./SettingsSelect";
import { normalizeOpenAiCompatibleBaseUrl, type DriftyAiRoute, type LocalAiSetupState } from "./localAiSetup";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";
import { useLocalization } from "../localization/LocalizationContext";
import { localizeAiConnectionTestMessage, localizeAiStatusLabel } from "../localization/aiStatusTranslations";

const CUSTOM_ENDPOINT_MODEL_ID = "custom_endpoint";
type AiSetupModelBeingUsedProps = {
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly driftyRoute: DriftyAiRoute;
  readonly localAiSetup: LocalAiSetupState;
  readonly managedLocalStatus: ManagedLocalAiStatus | null;
  readonly openRouterModelOptions: readonly AiModelOption[];
  readonly openRouterPrimaryModel: string;
  readonly selectedProvider: AiSetupSection;
  readonly actionModelId: string | null;
  readonly connectionStatus: AiConnectionStatus;
  readonly connectionTestKind: "success" | "error" | null;
  readonly connectionTestMessage: string | null;
  readonly connectionTestRunning: boolean;
  readonly connectionTestDisabled: boolean;
  readonly cloudSubscribeActionDisabled: boolean;
  readonly cloudSubscribeActionLabel: string | null;
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
  catalog,
  driftyRoute,
  localAiSetup,
  managedLocalStatus,
  openRouterModelOptions,
  openRouterPrimaryModel,
  selectedProvider,
  actionModelId,
  connectionStatus,
  connectionTestKind,
  connectionTestMessage,
  connectionTestRunning,
  connectionTestDisabled,
  cloudSubscribeActionDisabled,
  cloudSubscribeActionLabel,
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
  const providerOptions = [
    { value: "drifty", label: "Drifty", icon: aiProviderBrandMark("drifty", { pick: true }) },
    { value: "openrouter", label: "OpenRouter", icon: aiProviderBrandMark("openrouter", { pick: true }), muted: localAiSetup.openRouterApiKey.trim().length === 0 },
    { value: "custom", label: t("settings.ai.customEndpoint"), icon: aiProviderBrandMark("custom", { pick: true }), muted: !(normalizeOpenAiCompatibleBaseUrl(localAiSetup.selfHostedBaseUrl) && localAiSetup.selfHostedModel.trim().length > 0) },
  ] satisfies readonly SettingsSelectOption<AiSetupSection>[];
  const selectedModelValue = (() => {
    switch (selectedProvider) {
      case "drifty":
        return driftyRoute === "cloud" ? DRIFTY_CLOUD_MODEL_ID : localAiSetup.managedLocalModelId;
      case "openrouter":
        return openRouterPrimaryModel;
      case "custom":
        return CUSTOM_ENDPOINT_MODEL_ID;
      default:
        return assertNever(selectedProvider);
    }
  })();
  const modelOptions = (() => {
    switch (selectedProvider) {
      case "drifty":
        return driftyModelOptions({
          catalog,
          status: managedLocalStatus,
          actionModelId,
          cloudSubscribeActionDisabled,
          cloudSubscribeActionLabel,
          cloudSelectable,
          canManageBilling,
          onInstallModel,
          onStartCloudSetup,
          onManageCloudBilling,
          onDeleteModel: requestDeleteModel,
          onRevealArtifact: revealManagedModelArtifact,
          t,
        });
      case "openrouter":
        return openRouterModelOptions.map((option) => ({ value: option.id, label: option.label }) satisfies SettingsSelectOption<string>);
      case "custom":
        return [{ value: CUSTOM_ENDPOINT_MODEL_ID, label: t("settings.ai.customEndpoint") } satisfies SettingsSelectOption<string>];
      default:
        return assertNever(selectedProvider);
    }
  })();

  const handleProviderChange = (provider: AiSetupSection) => {
    onProviderChange(provider);
  };

  const handleModelChange = (modelId: string) => {
    switch (selectedProvider) {
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
      regionAriaLabel={t("settings.ai.modelBeingUsed")}
      heading={t("settings.ai.classificationRoute")}
      headingAction={
        <button
          type="button"
          className="settings-btn ai-setup-current-model__test"
          aria-label={t("settings.ai.testConnectionAria")}
          disabled={connectionTestDisabled}
          onClick={() => void onTestConnection()}
        >
          {connectionTestRunning ? t("settings.ai.testing") : t("settings.ai.testConnection")}
        </button>
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
      statusMessage={connectionTestMessage && connectionTestKind
        ? localizeAiConnectionTestMessage(connectionTestMessage, connectionTestKind, effectiveLanguage, t)
        : connectionTestMessage}
      statusMessageKind={connectionTestKind}
    />
    {pendingDelete ? (
      <DeleteManagedModelModal
        modelLabel={pendingDelete.label}
        deleting={deleting}
        onCancel={() => (deleting ? undefined : setPendingDelete(null))}
        onConfirm={() => void confirmDeleteModel()}
      />
    ) : null}
    </>
  );
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
