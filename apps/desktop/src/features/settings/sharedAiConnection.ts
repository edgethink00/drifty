import { MANAGED_LOCAL_AI_FALLBACK_CATALOG } from "./managedLocalAiCatalog";
import type { AnalysisAiSetupState } from "./analysisModelSetup";
import type { LocalAiSetupState } from "./localAiSetup";

/** A connection default never replaces an existing explicit task override. */
export function resolveSharedAnalysisSetup(
  saved: AnalysisAiSetupState,
  connection: LocalAiSetupState,
  explicit: boolean,
): AnalysisAiSetupState {
  const managedLocal = {
    modelId: connection.managedLocalModelId,
    baseUrl: connection.managedLocalBaseUrl,
    model: connection.managedLocalModel,
  };
  if (explicit) return { ...saved, managedLocal };
  const common = { ...saved, managedLocal, selectionSource: "automatic" as const };
  switch (connection.provider) {
    case "managed_local":
      return { ...common, provider: connection.driftyRoute === "local" ? "managed_local" : "cloud" };
    case "openrouter_byok":
      return { ...common, provider: "openrouter", openRouterModel: connection.openRouterModel,
        openRouterFallbackModels: connection.openRouterFallbackModels };
    case "openai":
      return { ...common, provider: "openai", openaiModel: connection.openaiModel };
    case "anthropic":
      return { ...common, provider: "anthropic", anthropicModel: connection.anthropicModel };
    case "self_hosted":
      return { ...common, provider: "self_hosted", selfHostedModel: connection.selfHostedModel };
  }
}

export function analysisConnectionLabel(setup: AnalysisAiSetupState): string {
  switch (setup.provider) {
    case "cloud": return "Drifty Cloud";
    case "managed_local": return MANAGED_LOCAL_AI_FALLBACK_CATALOG.find(model => model.id === setup.managedLocal?.modelId)?.label ?? "Local AI";
    case "openrouter": return `OpenRouter · ${setup.openRouterModel}`;
    case "openai": return `OpenAI · ${setup.openaiModel}`;
    case "anthropic": return `Anthropic · ${setup.anthropicModel}`;
    case "self_hosted": return setup.selfHostedModel || "Custom endpoint";
  }
}
