import type { Dispatch, SetStateAction } from "react";

import driftyLogoUrl from "../../assets/drifty-icon.png";
import openRouterLogoUrl from "../../assets/openrouter-logo.png";
import type { AiConnectionStatus } from "../ai-connection/AiConnectionStatusBar";
import { DRIFTY_CLOUD_MODEL_ID, driftyModelOptions, isSelectableManagedModel } from "./AiSetupDriftyModelOptions";
import type { AiModelOption } from "./AiSetupModelDialogs";
import type { AiSetupSection } from "./AiSetupSectionCards";
import type { DriftyRoute } from "./DriftySetupPanel";
import { ModelBeingUsedCard } from "./ModelBeingUsedCard";
import { type SettingsSelectOption } from "./SettingsSelect";
import type { LocalAiSetupState } from "./localAiSetup";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";
import { useLocalization } from "../localization/LocalizationContext";
import { localizeAiConnectionTestMessage, localizeAiStatusLabel } from "../localization/aiStatusTranslations";

const CUSTOM_ENDPOINT_MODEL_ID = "custom_endpoint";
type AiSetupModelBeingUsedProps = {
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly driftyRoute: DriftyRoute;
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
  readonly onDriftyRouteChange: (route: DriftyRoute) => void;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
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
  onDriftyRouteChange,
  onInstallModel,
  onLocalAiSetupChange,
  onOpenRouterPrimaryModelChange,
  onProviderChange,
  onTestConnection,
  onStartCloudSetup,
}: AiSetupModelBeingUsedProps) {
  const { effectiveLanguage, t } = useLocalization();
  const localizedConnectionStatus = {
    label: localizeAiStatusLabel(connectionStatus.label, t),
    providerLabel: localizeAiStatusLabel(connectionStatus.providerLabel, t),
  };
  const providerOptions = [
    { value: "drifty", label: "Drifty", iconSrc: driftyLogoUrl },
    { value: "openrouter", label: "OpenRouter", iconSrc: openRouterLogoUrl },
    { value: "custom", label: t("settings.ai.customEndpoint"), accentColor: "var(--accent)" },
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
        return driftyModelOptions(
          catalog,
          managedLocalStatus,
          actionModelId,
          cloudSubscribeActionDisabled,
          cloudSubscribeActionLabel,
          onInstallModel,
          onStartCloudSetup,
          t,
        );
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
          if (cloudSubscribeActionLabel !== null) return;
          onDriftyRouteChange("cloud");
          onProviderChange("drifty");
          return;
        }
        if (!isSelectableManagedModel(modelId, managedLocalStatus)) return;
        onDriftyRouteChange("local");
        onProviderChange("drifty");
        onLocalAiSetupChange((current) => ({ ...current, provider: "managed_local", driftyRoute: "local", managedLocalModelId: modelId }));
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
    <ModelBeingUsedCard
      regionAriaLabel={t("settings.ai.modelBeingUsed")}
      heading={t("settings.ai.modelBeingUsed")}
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
  );
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
