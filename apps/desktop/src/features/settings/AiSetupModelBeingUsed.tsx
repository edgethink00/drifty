import type { Dispatch, SetStateAction } from "react";

import type { AiModelOption } from "./AiSetupModelDialogs";
import type { AiSetupSection } from "./AiSetupSectionCards";
import type { DriftyRoute } from "./DriftySetupPanel";
import type { LocalAiSetupState } from "./localAiSetup";
import type { ManagedLocalAiModel } from "./managedLocalAiClient";

const DRIFTY_CLOUD_MODEL_ID = "drifty_cloud";

type AiSetupModelBeingUsedProps = {
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly driftyRoute: DriftyRoute;
  readonly localAiSetup: LocalAiSetupState;
  readonly openRouterModelOptions: readonly AiModelOption[];
  readonly openRouterPrimaryModel: string;
  readonly selectedProvider: AiSetupSection;
  readonly onDriftyRouteChange: (route: DriftyRoute) => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onOpenRouterPrimaryModelChange: (modelId: string) => void;
  readonly onProviderChange: (provider: AiSetupSection) => void;
};

export function AiSetupModelBeingUsed({
  catalog,
  driftyRoute,
  localAiSetup,
  openRouterModelOptions,
  openRouterPrimaryModel,
  selectedProvider,
  onDriftyRouteChange,
  onLocalAiSetupChange,
  onOpenRouterPrimaryModelChange,
  onProviderChange,
}: AiSetupModelBeingUsedProps) {
  const selectedModelValue = selectedProvider === "openrouter"
    ? openRouterPrimaryModel
    : driftyRoute === "cloud"
      ? DRIFTY_CLOUD_MODEL_ID
      : localAiSetup.managedLocalModelId;

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
        <label className="ai-setup-select-control">
          <span className="sr-only">AI provider</span>
          <select aria-label="AI provider" value={selectedProvider} onChange={(event) => handleProviderChange(providerFromValue(event.target.value))}>
            <option value="drifty">Drifty</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </label>
        <span className="ai-setup-current-model__slash" aria-hidden="true">/</span>
        <label className="ai-setup-select-control ai-setup-select-control--model">
          <span className="sr-only">AI model</span>
          <select aria-label="AI model" value={selectedModelValue} onChange={(event) => handleModelChange(event.target.value)}>
            {selectedProvider === "drifty" ? (
              <>
                <option value={DRIFTY_CLOUD_MODEL_ID}>Drifty Cloud</option>
                {catalog.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </>
            ) : openRouterModelOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function providerFromValue(value: string): AiSetupSection {
  return value === "openrouter" ? "openrouter" : "drifty";
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
