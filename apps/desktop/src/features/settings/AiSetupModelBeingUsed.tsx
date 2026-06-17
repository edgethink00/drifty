import type { Dispatch, SetStateAction } from "react";

import driftyLogoUrl from "../../assets/drifty-icon.png";
import openRouterLogoUrl from "../../assets/openrouter-logo.png";
import type { AiModelOption } from "./AiSetupModelDialogs";
import type { AiSetupSection } from "./AiSetupSectionCards";
import type { DriftyRoute } from "./DriftySetupPanel";
import { SettingsSelect, type SettingsSelectOption } from "./SettingsSelect";
import type { LocalAiSetupState } from "./localAiSetup";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";

const DRIFTY_CLOUD_MODEL_ID = "drifty_cloud";
const PROVIDER_OPTIONS = [
  { value: "drifty", label: "Drifty", iconSrc: driftyLogoUrl },
  { value: "openrouter", label: "OpenRouter", iconSrc: openRouterLogoUrl },
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
  readonly onDriftyRouteChange: (route: DriftyRoute) => void;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onOpenRouterPrimaryModelChange: (modelId: string) => void;
  readonly onProviderChange: (provider: AiSetupSection) => void;
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
  onDriftyRouteChange,
  onInstallModel,
  onLocalAiSetupChange,
  onOpenRouterPrimaryModelChange,
  onProviderChange,
}: AiSetupModelBeingUsedProps) {
  const selectedManagedModelReady = isSelectableManagedModel(localAiSetup.managedLocalModelId, managedLocalStatus);
  const selectedModelValue = selectedProvider === "openrouter"
    ? openRouterPrimaryModel
    : driftyRoute === "cloud"
      ? DRIFTY_CLOUD_MODEL_ID
      : selectedManagedModelReady
        ? localAiSetup.managedLocalModelId
        : DRIFTY_CLOUD_MODEL_ID;
  const modelOptions = selectedProvider === "drifty"
    ? driftyModelOptions(catalog, managedLocalStatus, actionModelId, onInstallModel)
    : openRouterModelOptions.map((option) => ({ value: option.id, label: option.label }) satisfies SettingsSelectOption<string>);

  const handleProviderChange = (provider: AiSetupSection) => {
    onProviderChange(provider);
    if (provider === "openrouter") {
      onLocalAiSetupChange((current) => ({ ...current, provider: "openrouter_byok" }));
      return;
    }
    if (driftyRoute === "local") {
      onLocalAiSetupChange((current) => ({ ...current, provider: "managed_local" }));
    }
  };

  const handleModelChange = (modelId: string) => {
    switch (selectedProvider) {
      case "drifty":
        if (modelId === DRIFTY_CLOUD_MODEL_ID) {
          onDriftyRouteChange("cloud");
          onProviderChange("drifty");
          return;
        }
        if (!isSelectableManagedModel(modelId, managedLocalStatus)) return;
        onDriftyRouteChange("local");
        onProviderChange("drifty");
        onLocalAiSetupChange((current) => ({ ...current, provider: "managed_local", managedLocalModelId: modelId }));
        return;
      case "openrouter":
        onProviderChange("openrouter");
        onLocalAiSetupChange((current) => ({ ...current, provider: "openrouter_byok" }));
        onOpenRouterPrimaryModelChange(modelId);
        return;
      default:
        return assertNever(selectedProvider);
    }
  };

  return (
    <section className="ai-setup-current-model" aria-label="Model being used">
      <h4>Model being used</h4>
      <div className="ai-setup-current-model__controls">
        <SettingsSelect
          ariaLabel="AI provider"
          className="ai-setup-select-control"
          value={selectedProvider}
          options={PROVIDER_OPTIONS}
          onChange={handleProviderChange}
        />
        <span className="ai-setup-current-model__slash" aria-hidden="true">/</span>
        <SettingsSelect
          ariaLabel="AI model"
          className="ai-setup-select-control ai-setup-select-control--model"
          value={selectedModelValue}
          options={modelOptions}
          onChange={handleModelChange}
        />
      </div>
    </section>
  );
}

function driftyModelOptions(
  catalog: readonly ManagedLocalAiModel[],
  status: ManagedLocalAiStatus | null,
  actionModelId: string | null,
  onInstallModel: (modelId: string) => void | Promise<void>,
): readonly SettingsSelectOption<string>[] {
  return [
    { value: DRIFTY_CLOUD_MODEL_ID, label: "Drifty Cloud", iconSrc: driftyLogoUrl },
    ...catalog.map((model) => {
      const selectable = isSelectableManagedModel(model.id, status);
      if (selectable) return { value: model.id, label: model.label };
      return {
        value: model.id,
        label: model.label,
        disabled: true,
        actionLabel: actionModelId === model.id ? "Downloading..." : "Download",
        actionAriaLabel: `Download ${model.label} managed local model`,
        actionDisabled: Boolean(actionModelId),
        onAction: (modelId: string) => {
          void onInstallModel(modelId);
        },
      };
    }),
  ];
}

function isSelectableManagedModel(modelId: string, status: ManagedLocalAiStatus | null): boolean {
  if (status?.selectedModelId !== modelId) return false;
  switch (status.state) {
    case "installed":
    case "running":
      return true;
    case "installing":
    case "error":
    case "not_installed":
      return false;
    default:
      return assertNever(status.state);
  }
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
