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

const CUSTOM_ENDPOINT_MODEL_ID = "custom_endpoint";
const CUSTOM_ENDPOINT_MODEL_OPTION = { value: CUSTOM_ENDPOINT_MODEL_ID, label: "Custom endpoint" } as const satisfies SettingsSelectOption<string>;
const PROVIDER_OPTIONS = [
  { value: "drifty", label: "Drifty", iconSrc: driftyLogoUrl },
  { value: "openrouter", label: "OpenRouter", iconSrc: openRouterLogoUrl },
  { value: "custom", label: "Custom endpoint", accentColor: "var(--accent)" },
] satisfies readonly SettingsSelectOption<AiSetupSection>[];

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
        );
      case "openrouter":
        return openRouterModelOptions.map((option) => ({ value: option.id, label: option.label }) satisfies SettingsSelectOption<string>);
      case "custom":
        return [CUSTOM_ENDPOINT_MODEL_OPTION];
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
      regionAriaLabel="Model being used"
      heading="Model being used"
      headingAction={
        <button
          type="button"
          className="settings-btn ai-setup-current-model__test"
          aria-label="Test AI connection"
          disabled={connectionTestDisabled}
          onClick={() => void onTestConnection()}
        >
          {connectionTestRunning ? "Testing..." : "Test connection"}
        </button>
      }
      tone={connectionStatus.tone}
      statusLabel={connectionStatus.label}
      statusProviderLabel={connectionStatus.providerLabel}
      statusAriaLabel={`AI status: ${connectionStatus.label}, ${connectionStatus.providerLabel}`}
      providerAriaLabel="AI provider"
      providerValue={selectedProvider}
      providerOptions={PROVIDER_OPTIONS}
      onProviderChange={(value) => handleProviderChange(value as AiSetupSection)}
      modelAriaLabel="AI model"
      modelValue={selectedModelValue}
      modelOptions={modelOptions}
      onModelChange={handleModelChange}
      statusMessage={connectionTestMessage}
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
